/**
 * The conversation tracker: one invisible marker in the composer dock that
 * reports whether this conversation is actually being looked at.
 *
 * Presence is four conditions at once (B model §3.1): the marker is mounted,
 * it intersects the viewport, the tab is visible, and the window is focused.
 * The marker is 1×1, so "intersects" is a real layout answer rather than a
 * guess from a scroll position. There is no blur grace period: the host's
 * three-minute bridge is the grace, which keeps the tracker from pretending a
 * hidden tab is attention.
 *
 * Every observation is one host-stamped event (`in`, `beat`, `prompt`, `out`);
 * no browser clock travels. The 20-second heartbeat is shared by every mounted
 * tracker, so ten open conversations do not mean ten intervals.
 *
 * A prompt is inferred from the session's live snapshot: a new accepted echo in
 * `pendingSubmissions`, or a false→true `running` transition. This is the
 * signal the input dock can see without reading the user's text.
 */
import { useEffect, useRef, type JSX } from 'react'
import type { HabitClient, PresenceState } from '../api.ts'
import type { UseInputHook, UseSessionHook } from '../slots.ts'

/** Props: the injected client, the owner's session, and the runtime's hooks. */
export interface PresenceTrackerProps {
  readonly client: HabitClient
  readonly session: { readonly sessionId: string }
  readonly useSession: UseSessionHook
  readonly useInput: UseInputHook
}

/** One mounted tracker's contribution to the shared heartbeat. */
interface Subscriber {
  readonly active: () => boolean
  readonly beat: () => void
}

/**
 * The shared heartbeat.
 *
 * The timer exists only while at least one tracker is present; a tracker that
 * is not present never beats. `present` counts the active trackers, not the
 * mounted ones.
 */
const subscribers = new Set<Subscriber>()
let timer: ReturnType<typeof setInterval> | null = null
let present = 0

function startHeartbeat(): void {
  if (timer !== null || present === 0) return
  timer = setInterval(() => {
    for (const subscriber of subscribers) {
      if (subscriber.active()) subscriber.beat()
    }
  }, 20_000)
}

function stopHeartbeat(): void {
  if (present > 0 || timer === null) return
  clearInterval(timer)
  timer = null
}

function join(subscriber: Subscriber): () => void {
  subscribers.add(subscriber)
  return () => {
    subscribers.delete(subscriber)
    if (subscribers.size === 0) stopHeartbeat()
  }
}

/** The per-tab identity; sessionStorage keeps a reload in the same client. */
const CLIENT_KEY = 'personal-track:client-id'

function randomId(): string {
  const api = globalThis.crypto
  if (typeof api?.randomUUID === 'function') {
    try {
      return api.randomUUID()
    } catch {
      // An insecure context can expose the method and still refuse it.
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function clientIdOf(): string {
  try {
    const existing = globalThis.sessionStorage?.getItem(CLIENT_KEY)
    if (existing !== undefined && existing !== null && existing !== '') return existing
    const created = randomId()
    globalThis.sessionStorage?.setItem(CLIENT_KEY, created)
    return created
  } catch {
    // A storage-denied tab still gets a client identity for this page.
    return randomId()
  }
}

/** The invisible 1×1 marker that reports this conversation's presence. */
export function PresenceTracker({ client, session, useSession, useInput }: PresenceTrackerProps): JSX.Element {
  const snapshot = useSession(state => state)
  const phase = useInput(state => state.phase)
  const sessionId = snapshot.sessionId === '' ? session.sessionId : snapshot.sessionId
  const markerRef = useRef<HTMLSpanElement | null>(null)
  const ids = useRef<{ readonly clientId: string; readonly connectionId: string } | null>(null)
  if (ids.current === null) {
    ids.current = { clientId: clientIdOf(), connectionId: randomId() }
  }

  const send = (state: PresenceState, keepalive = false): void => {
    const current = ids.current
    if (current === null) return
    // A stale host 404s the new route; that is the time view's message to give,
    // not a stream of tracker errors. The next host update starts recording.
    void client.presence(
      sessionId,
      current.clientId,
      current.connectionId,
      state,
      keepalive ? { keepalive: true } : undefined,
    ).catch(() => {})
  }

  // The shared heartbeat's membership: the effect owns it while mounted.
  useEffect(() => {
    const marker = markerRef.current
    if (marker === null) return
    let intersecting = false
    let visible = document.visibilityState === 'visible'
    let focused = document.hasFocus()
    let active = false
    const subscriber: Subscriber = { active: () => active, beat: () => send('beat') }
    const leave = join(subscriber)

    const recompute = (): void => {
      const next = intersecting && visible && focused
      if (next === active) return
      active = next
      if (next) {
        present += 1
        startHeartbeat()
        send('in')
      } else {
        present -= 1
        send('out', true)
        stopHeartbeat()
      }
    }

    // The observer answers "is the composer marker laid out and on screen".
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
          intersecting = entries.some(entry => entry.isIntersecting)
          recompute()
        })
      : null
    if (observer === null) {
      intersecting = true
      recompute()
    } else {
      observer.observe(marker)
    }

    const onVisibility = (): void => {
      visible = document.visibilityState === 'visible'
      recompute()
    }
    const onFocus = (): void => {
      focused = true
      recompute()
    }
    const onBlur = (): void => {
      focused = false
      recompute()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    recompute()

    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      if (active) {
        active = false
        present -= 1
        send('out', true)
        stopHeartbeat()
      }
      leave()
    }
    // `send` closes over the current ids and client; the effect is per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sessionId])

  // A prompt leaves a two-minute tail; the tracker only needs to notice it.
  const pending = snapshot.pendingSubmissions.length
  const running = snapshot.running
  const previous = useRef({ pending, running })
  useEffect(() => {
    const before = previous.current
    previous.current = { pending, running }
    if (pending > before.pending || (running && !before.running)) send('prompt')
  }, [pending, running])

  // The composer's `sending` phase is the most direct signal — the user pressed
  // enter — and it survives a batched accept+consume that hides the pending
  // echo from the snapshot above. Duplicates are harmless: the tails union.
  const previousPhase = useRef(phase)
  useEffect(() => {
    const before = previousPhase.current
    previousPhase.current = phase
    if (phase === 'sending' && before !== 'sending') send('prompt')
  }, [phase])

  return <span ref={markerRef} className="pt-presence-marker" aria-hidden="true" />
}
