/**
 * Range statistics: everything the statistics panel shows, computed on demand.
 *
 * Nothing here is persisted (docs/adr/0002-derived-state-not-stored.md), and
 * nothing is computed on the client either: the host already holds every day in
 * memory, so one pass over the requested range answers the whole panel. The
 * per-day `dayFacts` are memoized, so a range costs one document read per day
 * no matter how many figures are derived from it.
 */
import { focusSeconds, paceMinPerKm, streakFor } from './derive.ts'
import { HABITS, habitMet, type Habit, type HabitId } from './habits.ts'
import { dayKeyRange, habitDayKey, type DayKey } from '../shared/habit-day.ts'
import type { DayBoundary } from './config.ts'
import type { DayFacts, HabitStore } from './store.ts'

/** How far back a streak is allowed to look (a year and a bit). */
const STREAK_SCAN_DAYS = 400

/** One habit's record across the range. */
export interface HabitStats {
  readonly id: HabitId
  /** The habit's display name — the same string the completion bar uses. */
  readonly label: string
  readonly met: number
  readonly days: number
  readonly ratio: number
  readonly streak: number
  /** One flag per day of the range, aligned with {@link StatsView.days}. */
  readonly perDay: readonly boolean[]
}

/** One day's completion, for the heat grid. */
export interface DayStats {
  readonly date: DayKey
  readonly done: number
  readonly total: number
  /** False for an untouched day — the grid draws those differently. */
  readonly stored: boolean
}

/** One run, as a point on the heart-rate / pace curve. */
export interface RunPoint {
  readonly date: DayKey
  readonly pace: number
  readonly avgHr: number
  readonly km: number
  readonly minutes: number
}

/** A media entry as the panel lists it. */
export interface MediaSummary {
  readonly id: string
  readonly kind: 'film' | 'book'
  readonly title: string
  readonly status: 'active' | 'done' | 'dropped'
  readonly rating?: number
  readonly finishedAt?: string
}

/** The whole statistics panel. */
export interface StatsView {
  readonly from: DayKey
  readonly to: DayKey
  readonly days: readonly DayStats[]
  readonly habits: readonly HabitStats[]
  readonly perfectDays: number
  readonly vocab: {
    readonly new: number
    readonly review: number
    readonly minutes: number
    readonly daysMet: number
    readonly surplus: number
  }
  readonly duolingo: { readonly lessons: number; readonly minutes: number; readonly daysMet: number }
  readonly runs: {
    readonly count: number
    readonly km: number
    readonly avgHr?: number
    /** Only the runs that carry both a distance and a heart rate. */
    readonly points: readonly RunPoint[]
  }
  readonly rope: {
    readonly sets: number
    readonly sets90: number
    readonly sets180: number
    readonly seconds: number
    readonly avgHr?: number
  }
  readonly pullup: { readonly sets: number; readonly seconds: number }
  readonly plank: { readonly sets: number; readonly seconds: number }
  readonly equipment: {
    readonly sets: number
    readonly reps: number
    /** One entry per (name, weight) — the same load is the only thing that
     *  merges; the same machine at another weight is another line of work. */
    readonly byName: readonly {
      readonly name: string
      readonly weight?: number
      readonly sets: number
      readonly reps: number
    }[]
  }
  readonly washing: { readonly count: number; readonly pieces: number }
  /**
   * Free-form training: how many sessions, how long, and what the devices
   * measured.
   *
   * `kcal` is the sum over the sessions that carried one, so a mixed range
   * reports what is actually known rather than treating a missing reading as
   * zero burn. `kcalSessions` says how many of `sessions` contributed, which is
   * the difference between "burned nothing" and "was not measured" — the panel
   * shows the count only when it is smaller than the session count.
   */
  readonly free: {
    readonly sessions: number
    readonly minutes: number
    readonly kcal: number
    readonly kcalSessions: number
  }
  readonly meals: {
    /** Breakfast alone: the panel shows one meal slot, not three. */
    readonly breakfast: { readonly days: number; readonly ratio: number }
    /** Every slot's recorded spend, summed. */
    readonly spend: number
  }
  readonly media: {
    /** Finished inside the range. */
    readonly finished: number
    /** Current totals, independent of the range. */
    readonly films: number
    readonly books: number
    readonly active: number
    readonly dropped: number
    readonly avgRating?: number
    readonly recently: readonly MediaSummary[]
  }
  readonly tasks: {
    /** Completed inside the range. */
    readonly done: number
    /** …of which were finished after their due date. */
    readonly doneLate: number
    /** Current counts, independent of the range. */
    readonly open: number
    readonly doing: number
    readonly overdue: number
  }
  /**
   * Time spent in focus mode, over both registries.
   *
   * A session belongs to the habit day it **started** on, and only closed ones
   * count — an open session has no honest end
   * (docs/adr/0002-derived-state-not-stored.md).
   */
  readonly focus: {
    readonly seconds: number
    readonly sessions: number
  }
}

/** Average of the defined numbers, or undefined for an empty set. */
function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Round to one decimal, keeping integers whole. */
const round1 = (value: number): number => Math.round(value * 10) / 10

/** Build the panel for `[from, to]`. */
export function buildStats(
  store: HabitStore,
  from: DayKey,
  to: DayKey,
  boundary: DayBoundary,
): StatsView {
  const keys = dayKeyRange(from, to)
  const factsCache = new Map<DayKey, DayFacts>()
  const factsOf = (key: DayKey): DayFacts => {
    const cached = factsCache.get(key)
    if (cached !== undefined) return cached
    const facts = store.dayFacts(key)
    factsCache.set(key, facts)
    return facts
  }

  /** The habit-day a stored instant belongs to. */
  const dayOfInstant = (instant: string | undefined): DayKey | undefined =>
    instant === undefined ? undefined : habitDayKey(new Date(instant), boundary)

  // --- the seven habits, each met when every cell it owns is full
  //
  // The predicate is not restated here: it is the bar's own rule, read off the
  // facts this range already derives, so 洗漱 (two cells, one habit) counts as
  // met exactly when both washes happened.
  const metOn = (habit: Habit, key: DayKey): boolean =>
    habitMet(habit, id => factsOf(key).cells.find(cell => cell.id === id)?.value ?? 0)

  const habits: HabitStats[] = HABITS.map((habit) => {
    const perDay = keys.map(key => metOn(habit, key))
    const metDays = perDay.filter(Boolean).length
    return {
      id: habit.id,
      label: habit.label,
      met: metDays,
      days: keys.length,
      ratio: keys.length === 0 ? 0 : metDays / keys.length,
      streak: streakFor(to, key => metOn(habit, key), STREAK_SCAN_DAYS),
      perDay,
    }
  })

  // --- per-day completion, for the heat grid
  const days: DayStats[] = keys.map((key) => {
    const facts = factsOf(key)
    return { date: key, done: facts.progress.done, total: facts.progress.total, stored: facts.stored !== null }
  })
  const perfectDays = keys.filter(key => factsOf(key).perfect).length

  // --- study
  let vocabNew = 0
  let vocabReview = 0
  let vocabMinutes = 0
  let vocabSurplus = 0
  let vocabDaysMet = 0
  let lessons = 0
  let lessonMinutes = 0
  let lessonDays = 0
  for (const key of keys) {
    const facts = factsOf(key)
    vocabNew += facts.vocab.doneNew
    vocabReview += facts.vocab.doneReview
    vocabMinutes += facts.vocab.minutes
    vocabSurplus += facts.vocab.surplusNew + facts.vocab.surplusReview
    if (facts.vocab.met) vocabDaysMet += 1
    if (facts.day.duolingo.length > 0) lessonDays += 1
    for (const lesson of facts.day.duolingo) {
      lessons += 1
      lessonMinutes += lesson.minutes
    }
  }

  // --- training
  const runPoints: RunPoint[] = []
  let runCount = 0
  let runKm = 0
  const runHr: number[] = []
  const ropeHr: number[] = []
  let ropeSets = 0
  let rope90 = 0
  let rope180 = 0
  let ropeSeconds = 0
  let pullupSets = 0
  let pullupSeconds = 0
  let plankSets = 0
  let plankSeconds = 0
  const equipmentByLoad = new Map<string, { name: string; weight?: number; sets: number; reps: number }>()
  let freeSessions = 0
  let freeMinutes = 0
  let freeKcal = 0
  let freeKcalSessions = 0
  let washingCount = 0
  let washingPieces = 0
  for (const key of keys) {
    const day = factsOf(key).day
    if (day.run !== null) {
      const pace = paceMinPerKm(day.run.minutes, day.run.distanceKm)
      runCount += 1
      runKm += day.run.distanceKm
      if (day.run.avgHr !== undefined) runHr.push(day.run.avgHr)
      if (pace !== undefined && day.run.avgHr !== undefined) {
        runPoints.push({
          date: key,
          pace: round1(pace),
          avgHr: day.run.avgHr,
          km: day.run.distanceKm,
          minutes: day.run.minutes,
        })
      }
    }
    for (const set of day.rope) {
      ropeSets += 1
      if (set.preset === 90) rope90 += 1
      else rope180 += 1
      ropeSeconds += set.seconds
      if (set.avgHr !== undefined) ropeHr.push(set.avgHr)
    }
    pullupSets += day.pullup.length
    for (const set of day.pullup) pullupSeconds += set.seconds
    plankSets += day.plank.length
    for (const set of day.plank) plankSeconds += set.seconds
    for (const set of day.equipment) {
      // Merged by (name, weight): two loads of the same machine at different
      // weights are different work, so only an identical load is the same entry.
      const key = `${set.name}\u0000${set.weight ?? ''}`
      const entry = equipmentByLoad.get(key) ?? { name: set.name, weight: set.weight, sets: 0, reps: 0 }
      entry.sets += 1
      entry.reps += set.reps
      equipmentByLoad.set(key, entry)
    }
    washingCount += day.washing.length
    for (const wash of day.washing) washingPieces += wash.pieces
    for (const session of day.free) {
      freeSessions += 1
      freeMinutes += session.minutes
      if (session.kcal !== undefined) {
        freeKcal += session.kcal
        freeKcalSessions += 1
      }
    }
  }

  // --- meals
  const mealSlots = ['breakfast', 'lunch', 'dinner'] as const
  const slotStats = mealSlots.map((slot) => {
    let count = 0
    let amount = 0
    for (const key of keys) {
      const meal = factsOf(key).day.meals[slot]
      if (meal === undefined) continue
      count += 1
      amount += meal.price ?? 0
    }
    return { slot, days: count, ratio: keys.length === 0 ? 0 : count / keys.length, amount }
  })

  // --- registries (the day-derived states are read through a view at `to`)
  const registry = store.view(to, to)
  const finishedInRange = (instant: string | undefined): boolean => {
    const day = dayOfInstant(instant)
    return day !== undefined && day >= from && day <= to
  }
  const mediaDone = registry.media.filter(entry => entry.status === 'done')
  const ratings = registry.media
    .map(entry => entry.rating)
    .filter((rating): rating is number => rating !== undefined)
  const recently: MediaSummary[] = registry.media.slice(0, 5).map(entry => ({
    id: entry.id,
    kind: entry.kind,
    title: entry.title,
    status: entry.status,
    ...(entry.rating === undefined ? {} : { rating: entry.rating }),
    ...(entry.finishedAt === undefined ? {} : { finishedAt: entry.finishedAt }),
  }))

  const completedTasks = registry.tasks.filter(task => finishedInRange(task.completedAt))
  const doneLate = completedTasks.filter((task) => {
    const completedDay = dayOfInstant(task.completedAt)
    return task.due !== undefined && completedDay !== undefined && completedDay > task.due
  }).length

  // --- focus: closed sessions that started inside the range
  const closedFocus = [
    ...registry.media.flatMap(entry => entry.focusSessions),
    ...registry.tasks.flatMap(entry => entry.focusSessions),
  ].flatMap(session => (session.endedAt === undefined || !finishedInRange(session.startedAt)
    ? []
    : [{ startedAt: session.startedAt, endedAt: session.endedAt }]))
  const focus = { seconds: focusSeconds(closedFocus), sessions: closedFocus.length }

  return {
    from,
    to,
    days,
    habits,
    perfectDays,
    vocab: {
      new: vocabNew,
      review: vocabReview,
      minutes: vocabMinutes,
      daysMet: vocabDaysMet,
      surplus: vocabSurplus,
    },
    duolingo: { lessons, minutes: lessonMinutes, daysMet: lessonDays },
    runs: {
      count: runCount,
      km: round1(runKm),
      ...(average(runHr) === undefined ? {} : { avgHr: Math.round(average(runHr) as number) }),
      points: runPoints,
    },
    rope: {
      sets: ropeSets,
      sets90: rope90,
      sets180: rope180,
      seconds: ropeSeconds,
      ...(average(ropeHr) === undefined ? {} : { avgHr: Math.round(average(ropeHr) as number) }),
    },
    pullup: { sets: pullupSets, seconds: pullupSeconds },
    plank: { sets: plankSets, seconds: plankSeconds },
    equipment: {
      sets: [...equipmentByLoad.values()].reduce((sum, entry) => sum + entry.sets, 0),
      reps: [...equipmentByLoad.values()].reduce((sum, entry) => sum + entry.reps, 0),
      byName: [...equipmentByLoad.values()]
        .map(entry => ({
          name: entry.name,
          ...(entry.weight === undefined ? {} : { weight: entry.weight }),
          sets: entry.sets,
          reps: entry.reps,
        }))
        .sort((a, b) => b.reps - a.reps),
    },
    washing: { count: washingCount, pieces: washingPieces },
    free: {
      sessions: freeSessions,
      minutes: round1(freeMinutes),
      kcal: Math.round(freeKcal),
      kcalSessions: freeKcalSessions,
    },
    meals: {
      breakfast: {
        days: slotStats.find(slot => slot.slot === 'breakfast')?.days ?? 0,
        ratio: slotStats.find(slot => slot.slot === 'breakfast')?.ratio ?? 0,
      },
      spend: round1(slotStats.reduce((sum, slot) => sum + slot.amount, 0)),
    },
    media: {
      finished: mediaDone.filter(entry => finishedInRange(entry.finishedAt)).length,
      films: registry.media.filter(entry => entry.kind === 'film').length,
      books: registry.media.filter(entry => entry.kind === 'book').length,
      active: registry.media.filter(entry => entry.status === 'active').length,
      dropped: registry.media.filter(entry => entry.status === 'dropped').length,
      ...(average(ratings) === undefined ? {} : { avgRating: round1(average(ratings) as number) }),
      recently,
    },
    tasks: {
      done: completedTasks.length,
      doneLate,
      open: registry.tasks.filter(task => task.state !== 'done').length,
      doing: registry.tasks.filter(task => task.state === 'doing').length,
      overdue: registry.tasks.filter(task => task.overdue).length,
    },
    focus,
  }
}
