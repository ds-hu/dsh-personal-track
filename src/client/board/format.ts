/**
 * Display formatting for the board.
 *
 * Instants travel as ISO strings and are shown in the browser's local zone;
 * habit-day keys are plain calendar dates and are formatted in UTC so a label
 * can never drift a day. The calendar arithmetic itself is **not** here: it is
 * `src/shared/habit-day.ts`, the one copy both halves use, so the board cannot
 * disagree with the host about which day it is
 * (docs/adr/0005-shared-habit-day.md).
 *
 * Anything a reader sees as *words* takes the panel's `t` ({@link Copy}); the
 * figures do not. That split is what keeps a date readable in both languages
 * without a second formatting module: `Intl` takes a tag, and the tag rides on
 * `t`.
 */
import { daysBetween, shiftDayKey } from '../../shared/habit-day.ts'
import type { RopeDuration } from '../../shared/rope.ts'
import type { Copy } from '../copy/index.tsx'
import { COPY, type CopyKey } from '../copy/table.ts'
import type { FieldSpec } from './fields.tsx'
import { habitLabel } from './names.ts'

/** The `Intl` tag for the panel's active language. */
export function tagOf(copy: Copy): string {
  return copy.language === 'zh' ? 'zh-CN' : copy.language === 'en' ? 'en-US' : copy.language
}

/** `09:41` in the browser's local zone, or an em dash when unset. */
export function timeOf(instant: string | null | undefined): string {
  if (instant === null || instant === undefined || instant === '') return '——'
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return '——'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The `HH:mm` value an `<input type="time">` needs for a stored instant.
 *
 * The board only ever sends a clock time back; the host resolves it inside the
 * habit day, so nothing here has to know about dates or the night tail.
 */
export function timeValueOf(instant: string | null | undefined): string {
  if (instant === null || instant === undefined || instant === '') return ''
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** The browser's clock as `HH:mm`. */
export function clockTimeOf(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * The standard time field, labelled in the panel's language and filled with the
 * current clock time.
 *
 * A new entry is normally recorded at the moment it happened, so "now" is the
 * value worth showing — and it is the instant the host would stamp anyway.
 * Call this while rendering: a module-level constant would freeze at import,
 * and `initial` still wins whenever an existing entry is being edited.
 */
export function timeField(copy: Copy): FieldSpec {
  return { name: 'time', label: copy('field.time'), kind: 'time', defaultValue: clockTimeOf() }
}

/** `9月16日` / `Sep 16` for a habit-day key. */
export function monthDayOf(key: string, copy: Copy): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!, 12))
    .toLocaleDateString(tagOf(copy), { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** `周三` / `Wed` for a habit-day key (computed in UTC, so it cannot drift). */
export function weekdayOf(key: string, copy: Copy): string {
  return new Date(`${key}T12:00:00Z`)
    .toLocaleDateString(tagOf(copy), { weekday: 'short', timeZone: 'UTC' })
}

/** The weekday of an arbitrary instant, in the panel's language. */
export function weekdayNameOf(at: Date, copy: Copy): string {
  return at.toLocaleDateString(tagOf(copy), { weekday: 'short' })
}

/** The date chip's text, marking the night tail the way the domain names it. */
export function dayLabelOf(key: string, night: boolean, copy: Copy): string {
  const monthDay = monthDayOf(key, copy)
  const weekday = weekdayOf(key, copy)
  return night ? `${monthDay} ${copy('date.night', { weekday })}` : `${monthDay} ${weekday}`
}

/** `¥12.5` — the currency symbol plus a trimmed amount. */
export function moneyOf(price: number | undefined): string {
  if (price === undefined) return ''
  return `¥${Number.isInteger(price) ? price : price.toFixed(2).replace(/0$/, '')}`
}

/**
 * The Sunday that ends the week containing `key`.
 *
 * Weeks start on Monday, the same convention the statistics ranges use, so
 * "本周末" is that Sunday — the deadline a new task defaults to. Parsed at noon
 * UTC and read back in UTC, so no local zone can shift the weekday.
 */
export function weekEndKey(key: string): string {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay()
  const fromMonday = (weekday + 6) % 7
  return shiftDayKey(key, 6 - fromMonday)
}

/** How close a deadline is, as the board colours it. */
export type DueLevel = 'overdue' | 'today' | 'soon' | 'week' | 'far'

/**
 * The band a deadline falls in: past, today, within three days, within a week,
 * or beyond. Bands are counted in whole days from the current habit day.
 *
 * With no habit day yet — the host's clock has not answered, or the first read
 * failed — nothing is urgent: an empty key would otherwise parse as an invalid
 * date and colour every deadline red.
 */
export function dueLevelOf(due: string, today: string): DueLevel {
  if (today === '') return 'far'
  const days = daysBetween(today, due)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 3) return 'soon'
  if (days <= 7) return 'week'
  return 'far'
}

/**
 * A count that may be fractional, with at most one decimal and no trailing
 * `.0` — the completion bar sums partial cells, so `4.5/9` and `5/9` are both
 * ordinary readings.
 */
export function fractionText(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

/**
 * A ratio as whole percent, clamped to `[0, 100]` and never `NaN`.
 *
 * The decimal sibling of {@link fractionText}, and the one owner of the rule:
 * the board, the copied plain-text report and the statistics panel all show the
 * same day's figure, so they must not each round it their own way. A ratio that
 * cannot be computed (an empty range, a division by zero) reads as 0, which is
 * also what `report.ts` used to special-case by hand.
 */
export function percentOf(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100)
}

/** Display text for a media status. */
export function mediaStatusLabel(status: string, copy: Copy): string {
  const key = `media.status.${status}` as CopyKey
  return key in COPY ? copy(key) : status
}

/** A checkpoint as the editor's textarea writes it. */
export interface CheckpointLine {
  readonly label: string
  readonly at: number
}

/**
 * The checkpoints textarea's contents, one `label@position` per line and
 * sorted by position — the axis order is the reading order.
 */
export function formatCheckpoints(checkpoints: readonly CheckpointLine[]): string {
  return [...checkpoints]
    .sort((a, b) => a.at - b.at)
    .map(checkpoint => `${checkpoint.label}@${checkpoint.at}`)
    .join('\n')
}

/**
 * Parse the checkpoints textarea. A line is `label@position` — the label may
 * itself contain `@`, so the *last* one separates; the position is a positive
 * whole number in the task's counting unit. Blank lines are left alone.
 */
export function parseCheckpoints(text: string, copy: Copy): { list: CheckpointLine[]; problem?: string } {
  const list: CheckpointLine[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (line === '') continue
    const separator = line.lastIndexOf('@')
    if (separator <= 0 || separator === line.length - 1) {
      return { list, problem: copy('checkpoint.problem', { line: index + 1 }) }
    }
    const label = line.slice(0, separator).trim()
    const at = Number(line.slice(separator + 1).trim())
    if (label === '' || !Number.isInteger(at) || at <= 0) {
      return { list, problem: copy('checkpoint.problem', { line: index + 1 }) }
    }
    list.push({ label, at })
  }
  return { list }
}

/**
 * Human text for whatever a handler threw.
 *
 * One translation for every surface that reports a failure, so a host code is
 * always shown the same way instead of by whichever component caught it. The
 * host sends a **code** and whatever figures the sentence needs
 * (`AppError.params`); the sentence itself is the panel's, which is the only
 * half that knows what language the reader is in. A code this build does not
 * know falls back to the host's own words with the code beside them, so a newer
 * host degrades to something readable instead of to a bare key.
 */
export function messageOf(cause: unknown, copy: Copy): string {
  if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
    const key = `error.${cause.code}` as CopyKey
    const params = 'params' in cause && typeof cause.params === 'object' && cause.params !== null
      ? { ...cause.params as Record<string, string | number> }
      : undefined
    // A `habit` parameter is an id the host named, so it is translated here:
    // the sentence is the panel's, and so is every name in it.
    if (params !== undefined && typeof params.habit === 'string') params.habit = habitLabel(params.habit, copy)
    if (key in COPY) return copy(key, params)
    return copy('error.withCode', { message: cause.message, code: cause.code })
  }
  return cause instanceof Error ? cause.message : String(cause)
}

/** A duration in the panel's own words: seconds below a minute, else minutes. */
export function durationText(duration: RopeDuration, copy: Copy): string {
  return duration.unit === 'seconds'
    ? copy('unit.seconds', { seconds: duration.value })
    : copy('unit.minutes', { minutes: duration.value })
}

/** Pace in minutes per kilometre; undefined when it cannot be computed. */export function paceOf(minutes: number, distanceKm: number): number | undefined {
  if (!(minutes > 0) || !(distanceKm > 0)) return undefined
  return minutes / distanceKm
}

/** `6'00"/km` for a pace, or an em dash when there is none. */
export function paceLabel(pace: number | undefined): string {
  if (pace === undefined) return '——'
  let whole = Math.floor(pace)
  let seconds = Math.round((pace - whole) * 60)
  if (seconds === 60) {
    seconds = 0
    whole += 1
  }
  return `${whole}'${String(seconds).padStart(2, '0')}"/km`
}
