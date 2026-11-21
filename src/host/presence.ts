/**
 * Raw conversation presence: the store behind the time view's conversation band.
 *
 * The store records **observations**, never durations: a client said it entered,
 * beat or left, or the user sent a prompt. Every event is stamped by the host's
 * clock, so a skewed browser cannot inflate or deflate a minute. The two-minute
 * tail, the three-minute bridges, the focus subtraction and the patrol row are
 * derived on read by `attention.ts`; this file keeps the raw events for
 * {@link PRESENCE_RAW_DAYS} days and the live sessions that have not been
 * checkpointed yet. Older days are folded into the time ledger — the same
 * intervals `readDay` would have produced — so the row the time view draws does
 * not change, only the detail behind it goes away.
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
import { habitDayKey, shiftDayKey, type DayBoundary, type DayKey } from '../shared/habit-day.ts'
import type { HabitDomain, PresenceDay, PresenceEvent, TimeItem } from './domain.ts'
import type { AttentionPrompt, AttentionSegment } from './attention.ts'
import { createLedger } from './ledger.ts'

/** A silent client is considered gone after this long without a beat. */
export const PRESENCE_IDLE_MS = 60_000

/** How often the active prefix is written down, bounding a crash's loss. */
export const PRESENCE_CHECKPOINT_MS = 5 * 60_000

/**
 * How many habit days keep their **raw** events.
 *
 * Three: today, yesterday, and one more. Older than that, the day is folded into
 * the time ledger — the same closed intervals the attention model would have
 * derived anyway, so nothing the time view draws changes; what goes away is the
 * in/out/beat detail that only ever grew (a real day is ~200 KB of it, four
 * fifths of which never survives the three-minute bridge as a separate visit).
 */
export const PRESENCE_RAW_DAYS = 3

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
  /**
   * Fold the days older than {@link PRESENCE_RAW_DAYS} into the time ledger.
   *
   * Idempotent, and cheap when there is nothing to do — the raw table only ever
   * holds the window, because a compacted day's events are deleted in the same
   * pass. Epoch milliseconds are not involved: "older" is a habit day, the same
   * unit everything else here counts in.
   */
  maintain(): Promise<void>
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

  /** What a run of raw events folds into: closed intervals, prompts, and the
   *  segments an `in` never closed (whose last beat is their observed end). */
  interface Folded {
    readonly segments: readonly AttentionSegment[]
    readonly prompts: readonly AttentionPrompt[]
    readonly open: ReadonlyMap<string, { readonly sessionId: string; readonly startedAt: string; readonly endedAt: string }>
  }

  /**
   * Fold one day's events into the intervals the attention model consumes.
   *
   * This is the *only* place that knows how in/beat/out pair up, which is what
   * lets compaction and the live read produce the same answer: a compacted day
   * stores exactly what this returns, and `readDay` hands it back unchanged.
   */
  function fold(events: readonly PresenceEvent[]): Folded {
    const ordered = [...events].sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    const open = new Map<string, { sessionId: string; startedAt: string; endedAt: string }>()
    const segments: AttentionSegment[] = []
    const prompts: AttentionPrompt[] = []

    for (const item of ordered) {
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

    return { segments, prompts, open }
  }

  const ledger = createLedger(input.domain)

  /**
   * Fold one raw day into the ledger and drop its events.
   *
   * Ledger ids are deterministic (`talk:<session>:<start>`), so an interrupted
   * pass that wrote before deleting cannot double a row when it runs again.
   */
  async function compact(day: DayKey): Promise<void> {
    const doc = table.get(day)
    if (doc === undefined) return
    const folded = fold(doc.events)
    // A visit that is still running keeps its `in` in this document, because
    // every later beat and the eventual `out` are written to the day the
    // session **started** in. Folding it away would delete that anchor: the
    // rest of the visit would rebuild the document without an `in`, fold to
    // nothing, and the tail would be lost for good — the very thing this window
    // exists to preserve. Wait until the session ends (the sweep closes it at
    // its lastSeen within a minute of going silent).
    for (const key of folded.open.keys()) {
      if (active.has(key)) return
    }
    // An `in` with no `out` ends at its last beat; with no beat at all it is
    // zero-length and says nothing, so it is dropped rather than stored as an
    // empty row.
    const spans = [...folded.segments, ...[...folded.open.values()]]
      .filter(segment => Date.parse(segment.endedAt) > Date.parse(segment.startedAt))
    const items: TimeItem[] = [
      ...spans.map(segment => ({
        kind: 'talk' as const,
        id: `talk:${segment.sessionId}:${segment.startedAt}`,
        session: segment.sessionId,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      })),
      ...folded.prompts.map(prompt => ({
        kind: 'prompt' as const,
        id: `prompt:${prompt.sessionId}:${prompt.at}`,
        session: prompt.sessionId,
        at: prompt.at,
      })),
    ]
    await ledger.write(day, items)
    await table.delete(day)
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
      const folded = fold(table.get(date)?.events ?? [])
      // Two sources, one answer: an old day's intervals live in the ledger, and
      // a day caught between the ledger write and the raw delete has both. Keyed
      // by what a row *is*, so the union cannot draw the same visit twice.
      const segments = new Map<string, AttentionSegment>()
      const prompts = new Map<string, AttentionPrompt>()
      const keepSegment = (segment: AttentionSegment): void => {
        segments.set(
          `${segment.sessionId}${KEY_SEPARATOR}${segment.startedAt}${KEY_SEPARATOR}${segment.endedAt}`,
          segment,
        )
      }
      const keepPrompt = (prompt: AttentionPrompt): void => {
        prompts.set(`${prompt.sessionId}${KEY_SEPARATOR}${prompt.at}`, prompt)
      }

      for (const item of ledger.read(date)) {
        if (item.kind === 'talk') {
          keepSegment({ sessionId: item.session, startedAt: item.startedAt, endedAt: item.endedAt })
        } else if (item.kind === 'prompt') {
          keepPrompt({ sessionId: item.session, at: item.at })
        }
      }
      for (const segment of folded.segments) keepSegment(segment)
      for (const prompt of folded.prompts) keepPrompt(prompt)

      // A stored `in` without an `out`: the client vanished. Its observed end is
      // the last beat, or the live lastSeen when the host still has it.
      for (const [key, current] of folded.open) {
        const live = active.get(key)
        keepSegment({
          sessionId: current.sessionId,
          startedAt: current.startedAt,
          endedAt: live?.lastSeenAt ?? current.endedAt,
        })
      }
      // A live session whose `in` somehow is not in this day's document (a host
      // that recovered from a shape it did not write) still contributes its prefix.
      for (const [key, live] of active) {
        if (folded.open.has(key) || live.day !== date) continue
        keepSegment({ sessionId: live.sessionId, startedAt: live.startedAt, endedAt: live.lastSeenAt })
      }

      return { segments: [...segments.values()], prompts: [...prompts.values()] }
    },

    async maintain() {
      const today = dayOf(input.now().toISOString())
      // `PRESENCE_RAW_DAYS` counts the days that keep their events, today
      // included — so the first day to fold is this one.
      const oldestRaw = shiftDayKey(today, -(PRESENCE_RAW_DAYS - 1))
      await enqueue(async () => {
        // The raw table is the queue: a compacted day is deleted in the same
        // pass, so in the steady state this loop holds three keys at most.
        for (const day of [...table.keys()]) {
          if (day >= oldestRaw) continue
          await compact(day)
        }
      })
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
