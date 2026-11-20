/**
 * The one-day time view: every recorded span of a habit day, grouped into the
 * three things a day of work is made of — focus, conversation and record.
 *
 * The shape is derived on read and **never stored**
 * (docs/adr/0002-derived-state-not-stored.md). What is stored are the facts it
 * reads: a registry entry's closed focus sessions, a day's session rows, and
 * the check-ins' instants. The read-side rules this module owns are:
 *
 * - a focus session belongs to the habit day it *started* in, closed ones only
 *   — an open session has no honest end, exactly as `focusSeconds` says;
 * - a record's `at` is its **end**; its start is `at − duration`, and a check-in
 *   without a stored duration borrows the habit's default (`CHECK_MINUTES`).
 *   That convention is what lets a record join the same union as a focus
 *   session; it is a convention, not a measured start, so the UI's field says
 *   “end time”;
 * - every printed total is a **union**. A record overlapping a focus session
 *   is one minute of the day, not two; `totals.covered` is the union of all
 *   three groups, while each group's own total is the sum of its rows;
 * - conversations (`talk`) are one row per conversation plus the `patrol` row
 *   for the gaps between them, derived from raw presence by `attention.ts`;
 *   the rows can overlap, so `totals.talk` is their union, not their sum.
 */
import {
  habitDayKey,
  instantForHabitDay,
  shiftDayKey,
  type DayBoundary,
  type DayKey,
} from '../shared/habit-day.ts'
import { unionSeconds, type TimeInterval } from '../shared/time-union.ts'
import { buildAttention } from './attention.ts'
import type { DayRecord } from './domain.ts'
import type { PresenceRead } from './presence.ts'
import type { HabitStore } from './store.ts'

/** One interval as the wire carries it. Re-exported so the two halves name one type. */
export type { TimeInterval } from '../shared/time-union.ts'

/** One row of the time view: an entry, a conversation, or a habit's records. */
export interface TimeRow {
  /** Stable identity inside its group; a React key, never a label. */
  readonly id: string
  /** Focus rows: the entry's title. Talk rows: absent (the client joins it). */
  readonly title?: string
  readonly intervals: readonly TimeInterval[]
  /** Sum of the row's intervals, not their union. */
  readonly seconds: number
}

/** One axis tick the host resolved in its own zone. */
export interface TimeTick {
  readonly at: string
  readonly label: string
}

/** The whole day's time view. */
export interface TimeView {
  readonly date: DayKey
  /** The habit day's first instant, and the next habit day's first instant. */
  readonly from: string
  readonly to: string
  /** When the night tail starts (the last `dayStartHour` hours of the day). */
  readonly nightFrom: string
  /** Axis labels in the host's zone; the browser only positions them. */
  readonly ticks: readonly TimeTick[]
  /** The boundary's zone, for the browser's block labels; undefined = local. */
  readonly timezone?: string
  readonly focus: readonly TimeRow[]
  /**
   * Conversation attention: one row per session plus the patrol row (`id`
   * `patrol`) for cross-conversation gaps. Rows can overlap; never sum them.
   */
  readonly talk: readonly TimeRow[]
  readonly records: readonly TimeRow[]
  readonly totals: {
    readonly focus: number
    readonly talk: number
    readonly records: number
    /** The union of all three groups: the day's wall-clock time with a record. */
    readonly covered: number
  }
}

/**
 * Default lengths of the check-ins that have no stored duration.
 *
 * These are assumptions, not facts: a wash is not stored with how long it took,
 * so the view gives it five minutes and says so. They live in code rather than
 * `Config` because the plugin's configurable surface is deliberately small and
 * a fork can change a number here; `0` means “no block for this habit”.
 */
export const CHECK_MINUTES = {
  wash: 5,
  shower: 15,
  meal: 20,
} as const

/** Build one habit day's time view from the store and its raw presence. */
export function buildTime(input: {
  readonly store: HabitStore
  readonly date: DayKey
  readonly today: DayKey
  readonly boundary: DayBoundary
  readonly presence: PresenceRead
  readonly now: Date
}): TimeView {
  const { store, date, today, boundary, presence, now } = input
  const view = store.view(date, today)
  const facts = store.dayFacts(date)
  const day = facts.day

  const focus = focusRows(view, date, boundary)
  const records = recordRows(day)
  const startHour = boundary.dayStartHour
  const clock = `${String(startHour).padStart(2, '0')}:00`
  const from = instantForHabitDay(date, clock, boundary)
  const to = instantForHabitDay(shiftDayKey(date, 1), clock, boundary)
  // The night tail is the midnight-to-start hours inside the habit day: the
  // clock `00:00` is before the boundary, so `instantForHabitDay` resolves it to
  // the next calendar day's midnight, which is the one this day contains.
  const nightFrom = startHour <= 0 ? to : instantForHabitDay(date, '00:00', boundary)

  const attention = buildAttention({
    segments: presence.segments,
    prompts: presence.prompts,
    // An open focus session is a hole too: the user is focusing right now, and
    // the conversation should not claim that minute. It is not a focus *row*
    // (the rows are closed sessions) but it is a subtraction.
    focus: focusHoles(view, date, boundary, now),
    from,
    to,
  })
  const talk: TimeRow[] = [
    ...attention.sessions.map(window => ({
      id: window.sessionId,
      intervals: window.intervals,
      seconds: window.seconds,
    })),
    ...(attention.patrol.length === 0 ? [] : [{
      id: 'patrol',
      intervals: attention.patrol,
      seconds: unionSeconds(attention.patrol),
    }]),
  ]
  const all = [...focus, ...talk, ...records].flatMap(row => row.intervals)

  return {
    date,
    from,
    to,
    nightFrom,
    ticks: tickLabels(date, boundary),
    ...(boundary.timezone === undefined ? {} : { timezone: boundary.timezone }),
    focus,
    talk,
    records,
    totals: {
      focus: sumSeconds(focus),
      // The talk total is the union of the session rows and the patrol; the
      // rows are attribution and can overlap, so their sum is not this number.
      talk: attention.totalSeconds,
      records: sumSeconds(records),
      covered: unionSeconds(all),
    },
  }
}

/** The three registries, flattened for the focus rows and the focus holes. */
function focusEntries(view: ReturnType<HabitStore['view']>) {
  return [
    ...view.tasks.map(entry => ({ owner: 'task', ...entry })),
    ...view.media.map(entry => ({ owner: 'media', ...entry })),
    ...view.todos.map(entry => ({ owner: 'todo', ...entry })),
  ]
}

/** One entry's closed, day-owned sessions as a focus row. */
function focusRows(
  view: ReturnType<HabitStore['view']>,
  date: DayKey,
  boundary: DayBoundary,
): TimeRow[] {
  const rows: TimeRow[] = []
  for (const entry of focusEntries(view)) {
    const intervals: TimeInterval[] = []
    for (const session of entry.focusSessions) {
      if (session.endedAt === undefined) continue
      const started = Date.parse(session.startedAt)
      if (!Number.isFinite(started)) continue
      if (habitDayKey(new Date(started), boundary) !== date) continue
      const ended = Date.parse(session.endedAt)
      if (!Number.isFinite(ended) || ended <= started) continue
      intervals.push({ startedAt: session.startedAt, endedAt: session.endedAt })
    }
    if (intervals.length === 0) continue
    rows.push({
      id: `${entry.owner}:${entry.id}`,
      title: entry.title,
      intervals,
      seconds: sumIntervals(intervals),
    })
  }
  return sortRows(rows)
}

/**
 * The focus intervals the conversation must not claim.
 *
 * The rows above are closed sessions only — an open focus has no row to draw —
 * but it still hides the conversation, so the subtraction takes the open
 * session's prefix up to `now`. A focus session belongs to the day it started
 * in, exactly like the rows.
 */
function focusHoles(
  view: ReturnType<HabitStore['view']>,
  date: DayKey,
  boundary: DayBoundary,
  now: Date,
): TimeInterval[] {
  const holes: TimeInterval[] = []
  for (const entry of focusEntries(view)) {
    for (const session of entry.focusSessions) {
      const started = Date.parse(session.startedAt)
      if (!Number.isFinite(started)) continue
      if (habitDayKey(new Date(started), boundary) !== date) continue
      if (session.endedAt !== undefined) {
        const ended = Date.parse(session.endedAt)
        if (Number.isFinite(ended) && ended > started) {
          holes.push({ startedAt: session.startedAt, endedAt: session.endedAt })
        }
        continue
      }
      if (now.getTime() > started) {
        holes.push({ startedAt: session.startedAt, endedAt: now.toISOString() })
      }
    }
  }
  return holes
}

/**
 * One row per habit that recorded a duration, with `at` read as the end.
 *
 * `equipment` and `washing` are deliberately absent: they carry reps and pieces,
 * not time. `meals` is one row with up to three intervals, and `wash` one row
 * with up to two, because the row is the habit and its total is the sum — the
 * same shape the board's cards have.
 */
function recordRows(day: DayRecord): TimeRow[] {
  const rows: TimeRow[] = []
  const push = (id: string, intervals: (TimeInterval | undefined)[]): void => {
    const kept = intervals.filter((interval): interval is TimeInterval => interval !== undefined)
    if (kept.length === 0) return
    rows.push({ id, intervals: kept, seconds: sumIntervals(kept) })
  }
  const after = (at: string, minutes: number): TimeInterval | undefined => {
    const end = Date.parse(at)
    if (!Number.isFinite(end) || !(minutes > 0)) return undefined
    return {
      startedAt: new Date(end - minutes * 60_000).toISOString(),
      endedAt: new Date(end).toISOString(),
    }
  }

  push('vocab', (day.vocab?.sessions ?? []).map(session => after(session.at, session.minutes)))
  push('duolingo', day.duolingo.map(session => after(session.at, session.minutes)))
  push('run', day.run === null ? [] : [after(day.run.at, day.run.minutes)])
  push('rope', day.rope.map(session => after(session.at, session.seconds / 60)))
  push('free', day.free.map(session => after(session.at, session.minutes)))
  push('pullup', day.pullup.map(session => after(session.at, session.seconds / 60)))
  push('plank', day.plank.map(session => after(session.at, session.seconds / 60)))
  push('wash', day.washes.times.map(at => after(at, CHECK_MINUTES.wash)))
  push('shower', day.shower.at === null ? [] : [after(day.shower.at, CHECK_MINUTES.shower)])
  push('meals', [
    day.meals.breakfast === undefined ? undefined : after(day.meals.breakfast.at, CHECK_MINUTES.meal),
    day.meals.lunch === undefined ? undefined : after(day.meals.lunch.at, CHECK_MINUTES.meal),
    day.meals.dinner === undefined ? undefined : after(day.meals.dinner.at, CHECK_MINUTES.meal),
  ])
  return sortRows(rows)
}

/** Sort rows by their first start, then by id so ties are stable. */
function sortRows(rows: TimeRow[]): TimeRow[] {
  return rows.sort((left, right) => {
    const leftStart = Date.parse(left.intervals[0]?.startedAt ?? '')
    const rightStart = Date.parse(right.intervals[0]?.startedAt ?? '')
    const a = Number.isFinite(leftStart) ? leftStart : Number.POSITIVE_INFINITY
    const b = Number.isFinite(rightStart) ? rightStart : Number.POSITIVE_INFINITY
    return a - b || left.id.localeCompare(right.id)
  })
}

/** Sum one row's own intervals; no merge, because a row's total is a sum. */
function sumIntervals(intervals: readonly TimeInterval[]): number {
  let total = 0
  for (const interval of intervals) {
    const span = (Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) / 1000
    if (Number.isFinite(span) && span > 0) total += span
  }
  return Math.round(total)
}

function sumSeconds(rows: readonly TimeRow[]): number {
  return rows.reduce((total, row) => total + row.seconds, 0)
}

/**
 * Seven four-hour labels from the habit day's **local** start, not seven
 * four-hour offsets from its first instant.
 *
 * The difference is the DST day: a four-hour step across a spring-forward
 * boundary lands at 09:00, 13:00, … and the seventh tick runs past midnight,
 * while the day itself is 23 hours long. Resolving each label at its wall-clock
 * time keeps the axis labels on the hours the habit day was written in.
 */
function tickLabels(date: DayKey, boundary: DayBoundary): TimeTick[] {
  const startHour = boundary.dayStartHour
  const label = (day: DayKey, hour: number): TimeTick => {
    const at = instantForHabitDay(day, `${String(hour).padStart(2, '0')}:00`, boundary)
    return { at, label: clockIn(at, boundary.timezone) }
  }
  // The first six are the day start and its four-hour steps; a step before the
  // boundary is the night tail, which `instantForHabitDay` places on the next
  // calendar day for us. The seventh is the next day's start, the day's end.
  const ticks = [0, 4, 8, 12, 16, 20].map(offset => label(date, (startHour + offset) % 24))
  ticks.push(label(shiftDayKey(date, 1), startHour))
  return ticks
}

/** `HH:mm` in the boundary's zone (undefined = host local). */
function clockIn(instant: string, timezone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...(timezone === undefined ? {} : { timeZone: timezone }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? ''
  return `${pick('hour')}:${pick('minute')}`
}
