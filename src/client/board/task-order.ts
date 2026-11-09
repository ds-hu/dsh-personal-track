/**
 * The one order the task registry is read in.
 *
 * The board's tile and the daily report's remaining-task list both sort with
 * `byDeadline`, so the export can never read in an order the screen does not
 * show. It is a pure function of the entries — no day, no clock — because a
 * task belongs to the registry rather than to a habit day.
 */
import type { TaskEntry } from '../types.ts'

/**
 * Collators, one per locale asked for.
 *
 * Built once rather than per comparison: `sort` calls the comparator O(n log n)
 * times, and a collator is not free to construct. Keyed by the locale string,
 * with the runtime default under `''`.
 */
const collators = new Map<string, Intl.Collator>()

/**
 * Compare two task titles the way a reader's own language does.
 *
 * Digits compare as numbers, so `L7.2` sorts before `L7.10` instead of after
 * it — a chapter list read in code-unit order looks scrambled at exactly the
 * point a reader is scanning it. Case and accents are ignored: two titles that
 * differ only there are the same title for ordering.
 *
 * @param a - one title.
 * @param b - the other.
 * @param locale - a BCP 47 tag, or omitted for the runtime's own default (the
 *   shell's language, which is also the language the panel speaks).
 * @returns negative when `a` leads `b`.
 */
export function compareTitles(a: string, b: string, locale?: string): number {
  const key = locale ?? ''
  const known = collators.get(key)
  const collator = known ?? new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
  if (known === undefined) collators.set(key, collator)
  return collator.compare(a, b)
}

/**
 * Unfinished first, each group by deadline ascending, whatever has no deadline
 * last, and — inside one deadline — alphabetically. What is due soonest is what
 * you must look at, finished items sink out of the way without disappearing, and
 * among equals the eye can find a title by name instead of by "when I typed it".
 *
 * The alphabetical tie-break is the one place the *language* matters: under a
 * Chinese shell `Intl.Collator` reads Han titles in pinyin and puts them ahead
 * of Latin ones, under an English shell it does neither. That is why the locale
 * is a parameter and not a constant — the reader's language is the shell's, and
 * a hard-coded `'zh'` would misplace every Latin title in an English one.
 *
 * @param a - one task.
 * @param b - another.
 * @param locale - passed through to {@link compareTitles}; omitted means the
 *   runtime's default, which is what the panel wants.
 * @returns the comparator's answer.
 */
export function byDeadline(a: TaskEntry, b: TaskEntry, locale?: string): number {
  const finished = (task: TaskEntry): number => (task.state === 'done' ? 1 : 0)
  if (finished(a) !== finished(b)) return finished(a) - finished(b)
  if (a.due !== b.due) {
    if (a.due === undefined) return 1
    if (b.due === undefined) return -1
    return a.due < b.due ? -1 : 1
  }
  return compareTitles(a.title, b.title, locale)
}
