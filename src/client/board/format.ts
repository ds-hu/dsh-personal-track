/**
 * Display formatting for the board.
 *
 * Instants travel as ISO strings and are shown in the browser's local zone;
 * habit-day keys are plain calendar dates and are formatted in UTC so a label
 * can never drift a day. The calendar arithmetic itself is **not** here: it is
 * `src/shared/habit-day.ts`, the one copy both halves use, so the board cannot
 * disagree with the host about which day it is
 * (docs/adr/0005-shared-habit-day.md).
 */
import { daysBetween, shiftDayKey } from '../../shared/habit-day.ts'
import type { FieldSpec } from './fields.tsx'

/** `09:41` in the browser's local zone, or an em dash when unset. */
export function timeOf(instant: string | null | undefined): string {
  if (instant === null || instant === undefined || instant === '') return '——'
  const date = new Date(instant)
  if (Number.isNaN(date.getTime())) return '——'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
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

/** A standard time input, described once for every editable entry. */
export const TIME_FIELD = { name: 'time', label: '时间', kind: 'time' } as const

/** The browser's clock as `HH:mm`. */
export function clockTimeOf(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * The time field with the current clock time filled in.
 *
 * A new entry is normally recorded at the moment it happened, so "now" is the
 * value worth showing — and it is the instant the host would stamp anyway.
 * Call this while rendering: a module-level constant would freeze at import,
 * and `initial` still wins whenever an existing entry is being edited.
 */
export function timeField(): FieldSpec {
  return { ...TIME_FIELD, defaultValue: clockTimeOf() }
}

/** `9月16日` for a habit-day key. */
export function monthDayOf(key: string): string {
  const [, month, day] = key.split('-')
  return `${Number(month)}月${Number(day)}日`
}

/** `周三` for a habit-day key (computed in UTC, so it cannot drift). */
export function weekdayOf(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('zh-CN', { weekday: 'short', timeZone: 'UTC' })
}

/** The date chip's text, marking the night tail the way the domain names it. */
export function dayLabelOf(key: string, night: boolean): string {
  const weekday = weekdayOf(key)
  return `${monthDayOf(key)} ${night ? `${weekday}夜` : weekday}`
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
export function mediaStatusLabel(status: string): string {
  return { active: '在列', done: '完成', dropped: '弃' }[status] ?? status
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
export function parseCheckpoints(text: string): { list: CheckpointLine[]; problem?: string } {
  const list: CheckpointLine[] = []
  const lines = text.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim()
    if (line === '') continue
    const separator = line.lastIndexOf('@')
    if (separator <= 0 || separator === line.length - 1) {
      return { list, problem: `检查点第 ${index + 1} 行要形如「第一章@10」` }
    }
    const label = line.slice(0, separator).trim()
    const at = Number(line.slice(separator + 1).trim())
    if (label === '' || !Number.isInteger(at) || at <= 0) {
      return { list, problem: `检查点第 ${index + 1} 行要形如「第一章@10」` }
    }
    list.push({ label, at })
  }
  return { list }
}

/**
 * Human text for whatever a handler threw.
 *
 * One translation for every surface that reports a failure, so a host code is
 * always shown the same way instead of by whichever component caught it.
 */
export function messageOf(cause: unknown): string {
  if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') {
    return `${cause.message}（${cause.code}）`
  }
  return cause instanceof Error ? cause.message : String(cause)
}

/** Pace in minutes per kilometre; undefined when it cannot be computed. */
export function paceOf(minutes: number, distanceKm: number): number | undefined {
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
