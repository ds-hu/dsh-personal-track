/**
 * Derived values — everything the plugin reports that is *not* stored.
 *
 * See docs/adr/0002-derived-state-not-stored.md: storing any of these would
 * create a second source of truth that every write path must maintain, and it
 * would break "backfill recomputes immediately".
 */
import type { DayRecord, TaskRecord } from './domain.ts'
import { HABITS, type CellId } from './habits.ts'
import { shiftDayKey, type DayKey } from '../shared/habit-day.ts'

/** One cell of the completion bar. */
export interface Cell {
  /** A habit cell id, or `task:<id>` for a task due on this day. */
  readonly id: string
  readonly label: string
  /** Completion as a fraction in `[0,1]`: 0 untouched, 1 complete, between = partial. */
  readonly value: number
}

/**
 * What a task contributes on the day it is due.
 *
 * Tasks carry no day of their own, so a day's bar includes one cell per task
 * whose deadline is that day — this is what makes today's homework part of
 * today's completion instead of a separate list.
 */
export interface DueTask {
  readonly id: string
  readonly title: string
  readonly current: number
  readonly total: number | undefined
}

/**
 * Weights used when vocabulary progress is computed, in fifths.
 *
 * A review word counts a fifth of a new word: the two targets are not
 * interchangeable effort, and a day that clears 60 reviews has not done the
 * work of 60 new words. Weights stay integral so the target comparison is
 * exact — floats would make `done >= target` misfire on values like `3 × 0.2`.
 */
const NEW_WEIGHT = 5
const REVIEW_WEIGHT = 1

/** Vocabulary target progress for one day. */
export interface VocabProgress {
  readonly doneNew: number
  readonly doneReview: number
  readonly targetNew: number
  readonly targetReview: number
  readonly minutes: number
  /** Completion ratio, capped at 1. */
  readonly ratio: number
  /** Amount beyond the target, reported separately. */
  readonly surplusNew: number
  readonly surplusReview: number
  /** True once the summed target is met. */
  readonly met: boolean
}

/** Task lifecycle state, derived from progress. */
export type TaskState = 'todo' | 'doing' | 'done'

/**
 * Vocabulary progress; the target block is absent until a day has one.
 *
 * Progress is weighted (see {@link NEW_WEIGHT}): both the target and what has
 * been done are counted in fifths, so "100%" still means "the target is met".
 */
export function vocabProgress(day: DayRecord | undefined): VocabProgress | undefined {
  const vocab = day?.vocab
  if (vocab === undefined) return undefined
  let doneNew = 0
  let doneReview = 0
  let minutes = 0
  for (const session of vocab.sessions) {
    doneNew += session.new
    doneReview += session.review
    minutes += session.minutes
  }
  const targetNew = vocab.target.new
  const targetReview = vocab.target.review
  const targetFifths = targetNew * NEW_WEIGHT + targetReview * REVIEW_WEIGHT
  const doneFifths = doneNew * NEW_WEIGHT + doneReview * REVIEW_WEIGHT
  return {
    doneNew,
    doneReview,
    targetNew,
    targetReview,
    minutes,
    ratio: targetFifths <= 0 ? (doneFifths > 0 ? 1 : 0) : Math.min(1, doneFifths / targetFifths),
    // Surplus stays a raw count: it answers "how many words past the target",
    // which is a quantity of words, not a weighted amount of work.
    surplusNew: Math.max(0, doneNew - targetNew),
    surplusReview: Math.max(0, doneReview - targetReview),
    met: targetFifths <= 0 ? doneFifths > 0 : doneFifths >= targetFifths,
  }
}

/** Duolingo's presence target: at least one lesson on the day. */
export function duolingoMet(day: DayRecord | undefined): boolean {
  return (day?.duolingo.length ?? 0) > 0
}

/**
 * 健身's presence target: at least one training record on the day.
 *
 * A **presence** target, like duolingo's: one cell, full as soon as anything was
 * trained. Not one cell per kind, because "did I train" is one question — a run
 * plus a set of pull-ups is one trained day, not two halves of one. Every
 * training kind counts: running, rope, pull-ups, plank, equipment, and free
 * sessions. The two laundry/study families deliberately do not: washing clothes
 * and studying are not training, and letting them fill this cell would make it a
 * second "did I do anything" bar.
 *
 * A run is a single entry rather than an array, so its null check stands apart;
 * free sessions are an array like the rest.
 */
export function sportMet(day: DayRecord | undefined): boolean {
  if (day === undefined) return false
  return day.run !== null
    || day.rope.length > 0
    || day.pullup.length > 0
    || day.plank.length > 0
    || day.equipment.length > 0
    || day.free.length > 0
}

/** Round to one decimal, keeping integers whole. */
function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/** A task's contribution to its due day, as a fraction in `[0,1]`. */
export function taskCellValue(task: DueTask): number {
  if (task.total === undefined) return task.current > 0 ? 1 : 0
  if (task.total <= 0) return task.current > 0 ? 1 : 0
  return Math.max(0, Math.min(1, task.current / task.total))
}

/**
 * One cell's fraction.
 *
 * The switch is exhaustive over {@link CellId}: a **格** added to the inventory
 * without a value rule here is a compile error — the compiler help the three
 * hand-kept inventories never had. `vocab` is the only cell that is genuinely
 * fractional; a task's cell is fractional too, but tasks are not habits and are
 * appended by the caller.
 */
function cellValue(id: CellId, day: DayRecord | undefined, vocab: VocabProgress | undefined): number {
  switch (id) {
    case 'wash1': return (day?.washes.times.length ?? 0) >= 1 ? 1 : 0
    case 'wash2': return (day?.washes.times.length ?? 0) >= 2 ? 1 : 0
    case 'shower': return day?.shower.at != null ? 1 : 0
    case 'breakfast': return day?.meals.breakfast !== undefined ? 1 : 0
    case 'lunch': return day?.meals.lunch !== undefined ? 1 : 0
    case 'dinner': return day?.meals.dinner !== undefined ? 1 : 0
    case 'vocab': return vocab?.ratio ?? 0
    case 'duolingo': return duolingoMet(day) ? 1 : 0
    case 'sport': return sportMet(day) ? 1 : 0
  }
}

/**
 * The day's completion bar: the inventory's cells plus one cell per task due
 * that day, each carrying a fraction rather than a flag.
 *
 * Most habits are all-or-nothing, but two are genuinely partial: vocabulary
 * reports its weighted target progress, and a task reports how far along it is.
 * A half-finished homework shows as a half-filled square, and the count reads
 * `4.5/9` — the bar answers "how much of today is done", not "how many boxes
 * are ticked".
 *
 * The cells come from `habits.ts`, so the bar and the statistics heat grid
 * cannot disagree about which habits exist.
 */
export function dayCells(day: DayRecord | undefined, dueTasks: readonly DueTask[] = []): Cell[] {
  const vocab = vocabProgress(day)
  return [
    ...HABITS.flatMap(habit => habit.cells.map(cell => ({
      id: cell.id,
      label: cell.label,
      value: cellValue(cell.id, day, vocab),
    }))),
    ...dueTasks.map(task => ({
      id: `task:${task.id}`,
      label: task.title,
      value: taskCellValue(task),
    })),
  ]
}

/** The board's `n/m` count: fractional cells sum, and the count keeps a decimal. */
export function cellProgress(
  day: DayRecord | undefined,
  dueTasks: readonly DueTask[] = [],
): { done: number; total: number } {
  const cells = dayCells(day, dueTasks)
  return {
    done: round1(cells.reduce((sum, cell) => sum + cell.value, 0)),
    total: cells.length,
  }
}

/** A perfect day completes every cell — including the tasks due that day. */
export function isPerfectDay(day: DayRecord | undefined, dueTasks: readonly DueTask[] = []): boolean {
  return dayCells(day, dueTasks).every(cell => cell.value >= 1)
}

/** Task state derived from progress (never stored). */
export function taskState(task: TaskRecord): TaskState {
  const { current, total } = task.progress
  if (total === undefined) return current > 0 ? 'done' : 'todo'
  if (current <= 0) return 'todo'
  return current >= total ? 'done' : 'doing'
}

/** Overdue: past its due date and not finished. */
export function isOverdue(task: TaskRecord, today: DayKey): boolean {
  if (task.due === undefined) return false
  if (taskState(task) === 'done') return false
  return task.due < today
}

/** Pace in minutes per kilometre; undefined when it cannot be computed. */
export function paceMinPerKm(minutes: number, distanceKm: number): number | undefined {
  if (!(minutes > 0) || !(distanceKm > 0)) return undefined
  return minutes / distanceKm
}

/** Format a pace as `m'ss"/km` for stats copy. */
export function formatPace(pace: number | undefined): string | undefined {
  if (pace === undefined) return undefined
  const whole = Math.floor(pace)
  const seconds = Math.round((pace - whole) * 60)
  return seconds === 60
    ? `${whole + 1}'00"/km`
    : `${whole}'${String(seconds).padStart(2, '0')}"/km`
}

/**
 * Consecutive satisfied habit days ending at `endKey` (inclusive).
 * A day with no record, or one that fails `isDone`, breaks the run.
 */
export function streakFor(
  endKey: DayKey,
  isDone: (key: DayKey) => boolean,
  maxDays = 3650,
): number {
  let streak = 0
  let key = endKey
  while (streak < maxDays && isDone(key)) {
    streak += 1
    key = shiftDayKey(key, -1)
  }
  return streak
}
