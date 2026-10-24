/**
 * Habit-day arithmetic — **the one copy**, shared by both halves.
 *
 * A **habit day** runs from `dayStartHour` local time to the same hour the next
 * calendar day, so 00:00–04:00 belongs to the previous day (the **night tail**).
 * Keys are plain `YYYY-MM-DD` calendar dates and carry no zone of their own:
 * only the moment a key is *derived* depends on the timezone.
 *
 * This module lives under `src/shared` because both programs need it: the host
 * decides which day a write belongs to, and the browser navigates between days
 * and colours deadlines. It used to be host-only with a hand-written mirror in
 * `src/client/board/format.ts`, and that mirror is exactly how the focus
 * overlay came to treat the local calendar date as "today" and disagree with
 * the board by a day during the night tail
 * (docs/adr/0005-shared-habit-day.md). It is isomorphic on purpose — `Intl` and
 * `Date` only, no `node:` imports, no DOM — so the browser bundle can inline it.
 */

const KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/** A `YYYY-MM-DD` habit-day key. */
export type DayKey = string

/** The part of the configuration that habit-day arithmetic needs. */
export interface DayBoundary {
  readonly dayStartHour: number
  readonly timezone?: string
}

/** Formatter for one zone (undefined = host local zone). */
function dateFormatter(timezone: string | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    ...(timezone === undefined ? {} : { timeZone: timezone }),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function hourFormatter(timezone: string | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    ...(timezone === undefined ? {} : { timeZone: timezone }),
    hour: '2-digit',
    hourCycle: 'h23',
  })
}

/** The habit day an instant belongs to. */
export function habitDayKey(instant: Date, boundary: DayBoundary): DayKey {
  const shifted = new Date(instant.getTime() - boundary.dayStartHour * 3_600_000)
  const parts = dateFormatter(boundary.timezone).formatToParts(shifted)
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')}`
}

/** True while the instant sits in the night tail (before the boundary hour). */
export function isNightTail(instant: Date, boundary: DayBoundary): boolean {
  if (boundary.dayStartHour <= 0) return false
  const hour = Number(hourFormatter(boundary.timezone).format(instant))
  return hour < boundary.dayStartHour
}

/** Reject anything that is not a `YYYY-MM-DD` key. */
export function assertDayKey(key: string): DayKey {
  if (!KEY_RE.test(key)) throw new Error(`invalid habit-day key: ${key}`)
  return key
}

/** Shift a key by whole days — pure calendar arithmetic, zone-free. */
export function shiftDayKey(key: DayKey, days: number): DayKey {
  assertDayKey(key)
  const [year, month, day] = key.split('-').map(Number) as [number, number, number]
  const moved = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`
}

/** Ascending key order; negative when `a` is earlier. */
export function compareDayKeys(a: DayKey, b: DayKey): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Whole days from `from` to `to`: 0 for the same day, negative when `to` is
 * earlier.
 *
 * The signed counterpart of {@link dayKeySpan}, and the one place the client's
 * **due band** measures distance from. Parsed and read back in UTC, so no local
 * zone can shift the count.
 */
export function daysBetween(from: DayKey, to: DayKey): number {
  const at = (key: DayKey): number => {
    assertDayKey(key)
    const [year, month, day] = key.split('-').map(Number) as [number, number, number]
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((at(to) - at(from)) / 86_400_000)
}

/** Every key from `from` to `to`, inclusive and ascending (empty when reversed). */
export function dayKeyRange(from: DayKey, to: DayKey): DayKey[] {
  assertDayKey(from)
  assertDayKey(to)
  const keys: DayKey[] = []
  for (let key = from; compareDayKeys(key, to) <= 0; key = shiftDayKey(key, 1)) {
    keys.push(key)
    if (keys.length > 4000) throw new Error('day range too large')
  }
  return keys
}

/** Whether `key` lies within `[from, to]`. */
export function isWithin(key: DayKey, from: DayKey, to: DayKey): boolean {
  return compareDayKeys(key, from) >= 0 && compareDayKeys(key, to) <= 0
}

/**
 * How many days `[from, to]` spans, inclusive.
 *
 * A cheap validation path: it counts without building the array (and stops at
 * `cap`), so an absurd range can be rejected before anything materializes.
 */
export function dayKeySpan(from: DayKey, to: DayKey, cap = 10_000): number {
  assertDayKey(from)
  assertDayKey(to)
  let span = 0
  for (let key = from; compareDayKeys(key, to) <= 0; key = shiftDayKey(key, 1)) {
    span += 1
    if (span > cap) return span
  }
  return span
}

/** Offset of a zone from UTC at one instant, in milliseconds. */
function zoneOffsetMs(timezone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? '0')
  const asUtc = Date.UTC(
    field('year'), field('month') - 1, field('day'),
    field('hour'), field('minute'), field('second'),
  )
  return asUtc - instant.getTime()
}

/** The instant for a wall-clock time on a calendar day, in the boundary's zone. */
function zonedInstant(
  calendarKey: DayKey,
  hour: number,
  minute: number,
  second: number,
  timezone: string | undefined,
): string {
  const [year, month, day] = calendarKey.split('-').map(Number) as [number, number, number]
  if (timezone === undefined) {
    return new Date(year, month - 1, day, hour, minute, second).toISOString()
  }
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = zoneOffsetMs(timezone, new Date(guess))
  let instant = guess - first
  const settled = zoneOffsetMs(timezone, new Date(instant))
  if (settled !== first) instant = guess - settled
  return new Date(instant).toISOString()
}

/**
 * Resolve a clock time (`HH:mm` or `HH:mm:ss`) back to an instant **inside**
 * the given habit day.
 *
 * This is the inverse of {@link habitDayKey}, and it is why the client never
 * builds timestamps itself: a time before the boundary hour belongs to the
 * calendar day *after* the key (the night tail), so 01:30 recorded on the habit
 * day `2026-09-16` is `2026-09-17T01:30` — exactly what a person means by
 * "half past one last night".
 */
export function instantForHabitDay(key: DayKey, clock: string, boundary: DayBoundary): string {
  assertDayKey(key)
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(clock.trim())
  if (match === null) throw new Error(`invalid clock time: ${clock}`)
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) throw new Error(`invalid clock time: ${clock}`)
  const calendarKey = hour < boundary.dayStartHour ? shiftDayKey(key, 1) : key
  return zonedInstant(calendarKey, hour, minute, second, boundary.timezone)
}
