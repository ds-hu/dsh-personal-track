/**
 * Raw conversation presence: the store behind the time view's conversation band.
 *
 * The store records **observations**, never durations: a client said it entered,
 * beat or left, or the user sent a prompt. Every event is stamped by the host's
 * clock, so a skewed browser cannot inflate or deflate a minute. The two-minute
 * tail, the three-minute bridges, the focus subtraction and the patrol row are
 * derived on read by `attention.ts`; this file only keeps the raw events and the
 * live sessions that have not been checkpointed yet.
 *
 * Three rules make the derived numbers survive crashes and reloads without
 * inventing time:
 *
 * - an **out** closes at the host's receive time; a **sweep** closes a silent
 *   session at its own `lastSeen`, never at the moment the sweep noticed it, so
 *   a dead tab contributes no dead time;
 * - a **checkpoint** writes the observed prefix every five minutes, so a host
 *   crash loses at most that prefix, not the conversation;
 * - writes are serialized through one chain; a read waits for that chain, so a
 *   read never sees half a segment's events.
 *
 * Event documents are keyed by the **habit day the segment started in** (or the
 * prompt's own day), not by the instant's calendar day: a conversation that
 * crosses 04:00 stays in one day's document, and the chart clips the displayed
 * part. This is the same start-day rule the focus sessions follow.
 */
import { randomUUID } from 'node:crypto'
import { habitDayKey, type DayBoundary, type DayKey } from '../shared/habit-day.ts'
import type { HabitDomain, PresenceDay, PresenceEvent } from './domain.ts'
import type { AttentionPrompt, AttentionSegment } from './attention.ts'

/** A silent client is considered gone after this long without a beat. */
export const PRESENCE_IDLE_MS = 60_000

/** How often the active prefix is written down, bounding a crash's loss. */
export const PRESENCE_CHECKPOINT_MS = 5 * 60_000

/** The raw observations of one habit day, after the store's live prefixes. */
export interface PresenceRead {
  readonly segments: readonly AttentionSegment[]
  readonly prompts: readonly AttentionPrompt[]
}

/** What the API and the time view call. */
export interface PresenceStore {
  /** The client is present: open a segment, or refresh its lastSeen. */
  in(sessionId: string, clientId: string, connectionId: string): Promise<void>
  /** The client is still present: refresh lastSeen; opens one if it is missing. */
  beat(sessionId: string, clientId: string, connectionId: string): Promise<void>
  /** The client left: close at the host's receive time. */
  out(sessionId: string, clientId: string, connectionId: string): Promise<void>
  /** The user sent a prompt: store an instant for the tail. */
  prompt(sessionId: string, clientId: string, connectionId: string): Promise<void>
  /** Close every silent session at its lastSeen. */
  sweep(): Promise<void>
  /** Write the observed prefix of every live session. */
  checkpoint(): Promise<void>
  /** The raw segments and prompts of one habit day, plus live prefixes. */
  readDay(date: DayKey): Promise<PresenceRead>
  /** Flush the live prefixes and stop using the domain. */
  close(): Promise<void>
}

/** One live session, in memory until it is closed or checkpointed. */
interface Active {
  readonly sessionId: string
  readonly clientId: string
  readonly connectionId: string
  readonly startedAt: string
  readonly day: DayKey
  lastSeenAt: string
  /** The last instant already written as an event; avoids a no-op checkpoint. */
  checkpointedAt: string
}

/** The separator inside the active-session key; the three ids cannot contain it. */
const KEY_SEPARATOR = '\u0000'

function sessionKey(sessionId: string, clientId: string, connectionId: string): string {
  return `${sessionId}${KEY_SEPARATOR}${clientId}${KEY_SEPARATOR}${connectionId}`
}

/** Build the presence store over an opened domain. */
export function createPresence(input: {
  readonly domain: HabitDomain
  readonly boundary: DayBoundary
  readonly now: () => Date
}): PresenceStore {
  const table = input.domain.table('presence')
  const active = new Map<string, Active>()
  let chain: Promise<void> = Promise.resolve()

  /** Serialize writes so a checkpoint and an out cannot interleave. */
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work)
    chain = next.then(() => undefined, () => undefined)
    return next
  }

  /** Append one event to the document of its start habit day. */
  async function append(day: DayKey, event: PresenceEvent): Promise<void> {
    const current = table.get(day)
    const doc: PresenceDay = current ?? { date: day, events: [] }
    await table.put(day, { ...doc, events: [...doc.events, event] })
  }

  /** One event with the host's id and the caller's instant. */
  function event(
    kind: 'presence' | 'prompt',
    state: 'in' | 'beat' | 'out' | undefined,
    sessionId: string,
    clientId: string,
    connectionId: string,
    at: string,
  ): PresenceEvent {
    return {
      id: randomUUID(),
      kind,
      ...(state === undefined ? {} : { state }),
      sessionId,
      clientId,
      connectionId,
      at,
    }
  }

  /** The habit day an instant belongs to, for a new segment or a prompt. */
  function dayOf(at: string): DayKey {
    return habitDayKey(new Date(at), input.boundary)
  }

  /** Open a session at `at`; the in event goes to its start day. */
  async function open(activeKey: string, sessionId: string, clientId: string, connectionId: string, at: string): Promise<void> {
    const day = dayOf(at)
    active.set(activeKey, {
      sessionId,
      clientId,
      connectionId,
      startedAt: at,
      day,
      lastSeenAt: at,
      checkpointedAt: at,
    })
    await append(day, event('presence', 'in', sessionId, clientId, connectionId, at))
  }

  return {
    async in(sessionId, clientId, connectionId) {
      await enqueue(async () => {
        const key = sessionKey(sessionId, clientId, connectionId)
        const at = input.now().toISOString()
        const current = active.get(key)
        if (current !== undefined) {
          current.lastSeenAt = at
          return
        }
        await open(key, sessionId, clientId, connectionId, at)
      })
    },

    async beat(sessionId, clientId, connectionId) {
      await enqueue(async () => {
        const key = sessionKey(sessionId, clientId, connectionId)
        const at = input.now().toISOString()
        const current = active.get(key)
        if (current === undefined) {
          // A lost `in` (a dropped request, a host restart) is recovered by the
          // first beat; the segment starts at the beat, not at a guessed past.
          await open(key, sessionId, clientId, connectionId, at)
          return
        }
        current.lastSeenAt = at
      })
    },

    async out(sessionId, clientId, connectionId) {
      await enqueue(async () => {
        const key = sessionKey(sessionId, clientId, connectionId)
        const current = active.get(key)
        if (current === undefined) return
        const at = input.now().toISOString()
        active.delete(key)
        await append(current.day, event('presence', 'out', sessionId, clientId, connectionId, at))
      })
    },

    async prompt(sessionId, clientId, connectionId) {
      await enqueue(async () => {
        const at = input.now().toISOString()
        await append(dayOf(at), event('prompt', undefined, sessionId, clientId, connectionId, at))
      })
    },

    async sweep() {
      await enqueue(async () => {
        const now = input.now().getTime()
        for (const [key, current] of [...active]) {
          if (now - Date.parse(current.lastSeenAt) <= PRESENCE_IDLE_MS) continue
          active.delete(key)
          // The end is the last observation, not the sweep's clock.
          await append(current.day, event('presence', 'out', current.sessionId, current.clientId, current.connectionId, current.lastSeenAt))
        }
      })
    },

    async checkpoint() {
      await enqueue(async () => {
        for (const current of active.values()) {
          if (Date.parse(current.lastSeenAt) <= Date.parse(current.checkpointedAt)) continue
          await append(current.day, event('presence', 'beat', current.sessionId, current.clientId, current.connectionId, current.lastSeenAt))
          current.checkpointedAt = current.lastSeenAt
        }
      })
    },

    async readDay(date) {
      // The read waits for the write chain: a half-applied segment is worse
      // than a slightly older one.
      await chain
      const doc = table.get(date)
      const events = [...(doc?.events ?? [])].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
      const open = new Map<string, { sessionId: string; startedAt: string; endedAt: string }>()
      const segments: AttentionSegment[] = []
      const prompts: AttentionPrompt[] = []

      for (const item of events) {
        if (item.kind === 'prompt') {
          prompts.push({ sessionId: item.sessionId, at: item.at })
          continue
        }
        const key = sessionKey(item.sessionId, item.clientId, item.connectionId)
        if (item.state === 'out') {
          const current = open.get(key)
          if (current === undefined) continue
          open.delete(key)
          segments.push({ sessionId: current.sessionId, startedAt: current.startedAt, endedAt: item.at })
          continue
        }
        if (item.state === 'in') {
          const current = open.get(key)
          if (current !== undefined) {
            // A second `in` on a key is a fresh observation after a host
            // restart — a live key's `in` writes nothing, so this cannot be a
            // retry. Close the old segment at its last observed instant and
            // start a new one: the downtime then becomes a gap the three-minute
            // bridge can judge, instead of being credited as attention.
            segments.push({ sessionId: current.sessionId, startedAt: current.startedAt, endedAt: current.endedAt })
            open.delete(key)
          }
          open.set(key, { sessionId: item.sessionId, startedAt: item.at, endedAt: item.at })
          continue
        }
        // beat
        const current = open.get(key)
        if (current !== undefined) current.endedAt = item.at
      }

      // A stored `in` without an `out`: the client vanished. Its observed end is
      // the last beat, or the live lastSeen when the host still has it.
      for (const [key, current] of open) {
        const live = active.get(key)
        segments.push({
          sessionId: current.sessionId,
          startedAt: current.startedAt,
          endedAt: live?.lastSeenAt ?? current.endedAt,
        })
      }
      // A live session whose `in` somehow is not in this day's document (a host
      // that recovered from a shape it did not write) still contributes its prefix.
      for (const [key, live] of active) {
        if (open.has(key) || live.day !== date) continue
        segments.push({ sessionId: live.sessionId, startedAt: live.startedAt, endedAt: live.lastSeenAt })
      }

      return { segments, prompts }
    },

    async close() {
      // Flush the live prefixes before the domain closes; the owner awaits this
      // ahead of `domain.close()`, because a disposing domain rejects puts.
      try {
        await enqueue(async () => {
          for (const current of active.values()) {
            if (Date.parse(current.lastSeenAt) <= Date.parse(current.checkpointedAt)) continue
            await append(current.day, event('presence', 'beat', current.sessionId, current.clientId, current.connectionId, current.lastSeenAt))
            current.checkpointedAt = current.lastSeenAt
          }
        })
      } finally {
        // Even when the domain refused the flush, the live map must not outlive
        // the store it belongs to.
        active.clear()
      }
    },
  }
}
