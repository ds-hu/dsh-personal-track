/**
 * The day as Markdown — what the 复制纯文本报告 button puts on the clipboard.
 *
 * One line per board group (日常 / 饮食 / 学习 / 健身), with 任务 closing the
 * report as a Markdown list, so a report reads top to bottom the way the board
 * does.
 *
 * **Completeness first**: the report is the whole day, not a digest of it, so
 * nothing the board shows is dropped for the sake of brevity. Every meal slot
 * appears with its own price, every set of a timed exercise appears with its
 * own seconds, equipment keeps its weight, and a group with nothing in it keeps
 * its line (`健身 —`) instead of vanishing into a gap the reader cannot tell
 * apart from "not recorded". This is display formatting of a slice the host
 * already sent: no extra reads and no truth of its own — every figure is one
 * the board is already showing for the same day.
 *
 * **It follows the interface language**, because it is pasted into a chat: a
 * report that stayed Chinese under an English shell would be the one text the
 * reader cannot read. So every word here comes from the panel's `t`, and the
 * figures are formatted the way the board formats them — one rule, two
 * languages, no second formatter.
 *
 * Tasks are the one cross-day registry that appears. The list carries every
 * unfinished task, whatever its deadline — the day it is due, a later one, or
 * none — each at its *current* progress and in the board's own order. It also
 * carries a finished task whose deadline is today or later: finishing today's
 * homework is part of today, and a report about the day should say so. A
 * finished task past its deadline has already sunk into the board's archive,
 * and one with no deadline says nothing about a day at all, so neither is listed.
 */
import type { ClockView, EquipmentSession, FreeSession, Meal, StateView } from '../types.ts'
import type { Copy } from '../copy/index.tsx'
import { mergeRope, ropeDurationOf, ropeTempo } from '../../shared/rope.ts'
import { dayLabelOf, durationText, fractionText, moneyOf, paceLabel, paceOf, percentOf } from './format.ts'
import { byDeadline } from './task-order.ts'

/** A report line; `null` when the group has nothing worth a line. */
type Line = string | null

/** 日常: the two checks plus the laundry stock. */
function dailyLine(state: StateView, t: Copy): Line {
  const record = state.day.day
  const washes = record?.washes.times.length ?? 0
  const shower = record?.shower.at != null
  const parts = [
    t('report.daily.wash', { times: washes }),
    shower ? t('report.daily.shower.done') : t('report.daily.shower.missing'),
  ]
  if (state.stock.pending > 0) parts.push(t('report.daily.laundry', { count: state.stock.pending }))
  return parts.join(' · ')
}

/** The three meal slots in the day's own order, each with its price. */
const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner'] as const

/**
 * 饮食: every slot named, so which meal is missing is readable rather than
 * counted. A slot recorded without a price shows ✓; the day's total is kept as
 * a tail for the figure the report used to carry alone.
 */
function mealsLine(state: StateView, t: Copy): Line {
  const meals = state.day.day?.meals ?? {}
  const spend = MEAL_SLOTS.reduce((sum, slot) => sum + (meals[slot]?.price ?? 0), 0)
  const text = MEAL_SLOTS
    .map((slot) => {
      const meal: Meal | undefined = meals[slot]
      const label = t(`meal.short.${slot}` as 'meal.short.breakfast')
      if (meal === undefined) return t('report.meal.missing', { meal: label })
      return `${label} ${meal.price === undefined ? '✓' : moneyOf(meal.price)}`
    })
    .join(' · ')
  const total = spend > 0 ? `${text}（${t('meal.spend', { amount: moneyOf(spend) })}）` : text
  return `${t('meal.total')} ${total}`
}

/** 学习: weighted vocabulary progress plus the day's lessons. */
function studyLine(state: StateView, t: Copy): Line {
  const vocab = state.day.vocab
  const percent = percentOf(vocab.ratio)
  const surplus = vocab.surplusNew + vocab.surplusReview
  const details = [
    t('report.study.new', { done: vocab.doneNew, target: vocab.targetNew }),
    t('report.study.review', { done: vocab.doneReview, target: vocab.targetReview }),
    ...(vocab.minutes > 0 ? [t('report.study.minutes', { minutes: vocab.minutes })] : []),
    ...(surplus > 0 ? [t('report.study.surplus', { count: surplus })] : []),
  ].join(' · ')
  const lessons = state.day.day?.duolingo ?? []
  const minutes = lessons.reduce((sum, lesson) => sum + lesson.minutes, 0)
  const duolingoText = lessons.length === 0
    ? t('report.study.duolingo.none')
    : minutes > 0
      ? t('report.study.duolingo', { lessons: lessons.length, minutes })
      : t('report.study.duolingo.lessons', { lessons: lessons.length })
  return `${t('report.study.vocab', { percent, detail: details })} · ${duolingoText}`
}

/** One set's seconds, so a timed habit reports every hold rather than a total. */
function secondsList(sets: readonly { readonly seconds: number }[], t: Copy): string {
  return t('report.seconds', { seconds: sets.map(set => set.seconds).join('+') })
}

/** One load of one machine: the only thing that merges is the same weight. */
interface LoadGroup {
  readonly name: string
  readonly weight?: number
  sets: number
  reps: number
}

/**
 * Equipment grouped by (name, weight), heaviest reading last within a name.
 *
 * Two sets of the same machine at different weights are different work, so they
 * never merge — and the weight is printed, because a set without its load says
 * almost nothing about the training.
 */
function equipmentText(sets: readonly EquipmentSession[], t: Copy): string {
  const groups = new Map<string, LoadGroup>()
  for (const set of sets) {
    const key = `${set.name}\u0000${set.weight ?? ''}`
    const entry = groups.get(key) ?? { name: set.name, weight: set.weight, sets: 0, reps: 0 }
    entry.sets += 1
    entry.reps += set.reps
    groups.set(key, entry)
  }
  return [...groups.values()]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.weight ?? 0) - (b.weight ?? 0)))
    .map(({ name, weight, sets: count, reps }) => (weight === undefined
      // Two rows rather than an empty `{weight}`: a double space is not a
      // translation, it is a rendering bug that only the eye catches.
      ? t('report.equipment.setPlain', { name, sets: count, reps })
      : t('report.equipment.set', { name, weight: `${weight}kg`, sets: count, reps })))
    .join(' · ')
}

/** One free-form session's duration, in the same per-entry style as the others. */
function freeText(sessions: readonly FreeSession[], t: Copy): string {
  const minutes = sessions.map(session => session.minutes).join('+')
  const measured = sessions.filter(session => session.kcal !== undefined)
  const kcal = measured.reduce((sum, session) => sum + (session.kcal ?? 0), 0)
  // A total burn that leaves out unmeasured sessions has to say so, or the
  // number reads as the whole day's. A comma rather than a second bracket: the
  // segment is already inside the duration's parentheses.
  const energy = measured.length === 0
    ? ''
    : measured.length === sessions.length
      ? ` · ${t('report.free.kcal', { kcal })}`
      : ` · ${t('report.free.measured', { kcal, measured: measured.length, count: sessions.length })}`
  const detail = `${t('report.study.minutes', { minutes })}${energy}`
  return t('report.free', { count: sessions.length, detail })
}

/**
 * 健身: only the training that happened gets a segment — but the line itself
 * always appears, so a rest day reads as a rest day.
 */
function fitnessLine(state: StateView, t: Copy): Line {
  const record = state.day.day
  const parts: string[] = []
  if (record !== null) {
    if (record.run !== null) {
      const pace = paceOf(record.run.minutes, record.run.distanceKm)
      parts.push(t('report.run', { distance: record.run.distanceKm, minutes: record.run.minutes })
        + `${pace === undefined ? '' : ` ${paceLabel(pace)}`}`
        + `${record.run.avgHr === undefined ? '' : ` ♥${record.run.avgHr}`}`)
    }
    const rope = mergeRope(record.rope)
    if (rope !== null) {
      const tempo = ropeTempo(rope.count, rope.seconds)
      parts.push(t('report.rope', { count: rope.count, duration: durationText(ropeDurationOf(rope.seconds), t) })
        + `${tempo === undefined ? '' : ` ${t('report.tempo', { tempo: fractionText(tempo) })}`}`
        + `${rope.avgHr === undefined ? '' : ` ♥${rope.avgHr}`}`)
    }
    if (record.pullup.length > 0) {
      parts.push(t('report.pullup', { sets: record.pullup.length, seconds: secondsList(record.pullup, t) }))
    }
    if (record.plank.length > 0) {
      parts.push(t('report.plank', { sets: record.plank.length, seconds: secondsList(record.plank, t) }))
    }
    if (record.equipment.length > 0) {
      parts.push(t('report.equipment', { detail: equipmentText(record.equipment, t) }))
    }
    if (record.free.length > 0) {
      parts.push(freeText(record.free, t))
    }
  }
  return parts.length === 0 ? t('report.training.none') : parts.join(' · ')
}

/** `9-24` — a deadline shown short inside the task list. */
function dueMark(due: string): string {
  const [, month, day] = due.split('-')
  return `${Number(month)}-${Number(day)}`
}

/**
 * 任务: what the board's task tile is showing, at its current progress — one
 * Markdown list item each, so a long registry stays readable and pastes as a
 * list rather than as one crammed line.
 *
 * Two kinds of entry are named: every unfinished task, and every *finished* one
 * whose deadline is today or later (see the module comment). The deadline is
 * always printed as `月-日`, an overdue one with 逾期 beside it: a report
 * pasted into a chat outlives the "today" it was written on, so a bare 逾期
 * would leave the reader unable to tell how late it is. A finished item ends
 * with ` ✓`, and the order is the board's own (`./task-order.ts`), so the
 * export reads top to bottom exactly as the tile does.
 */
function taskLines(state: StateView, clock: ClockView, t: Copy): Line {
  const listed = state.tasks
    .filter(task => task.state !== 'done' || (task.due !== undefined && task.due >= clock.today))
    .sort(byDeadline)
  if (listed.length === 0) return null
  const items = listed.map((task) => {
    const progress = task.progress.total === undefined
      ? ''
      : ` ${fractionText(task.progress.current)}/${fractionText(task.progress.total)}`
    const due = task.due === undefined
      ? ''
      : `（${dueMark(task.due)}${task.overdue ? ` ${t('report.overdue')}` : ''}）`
    const finished = task.state === 'done' ? ' ✓' : ''
    return `- ${task.title}${task.category === undefined ? '' : `（${task.category}）`}${progress}${due}${finished}`
  })
  // The blank line keeps the list a list in renderers that will not let one
  // interrupt the paragraph above it.
  return `${t('report.tasks')}\n\n${items.join('\n')}`
}

/** The whole report: a header, the completion figure, then one line per group. */
export function dayReport(state: StateView, clock: ClockView, t: Copy): string {
  const { day } = state
  const night = clock.nightTail && day.date === clock.today
  const percent = percentOf(day.progress.total === 0 ? 0 : day.progress.done / day.progress.total)
  const lines: Line[] = [
    t('report.title', { date: dayLabelOf(day.date, night, t) }),
    t('report.completion', {
      done: fractionText(day.progress.done),
      total: day.progress.total,
      percent,
    }),
    dailyLine(state, t),
    mealsLine(state, t),
    studyLine(state, t),
    fitnessLine(state, t),
    taskLines(state, clock, t),
  ]
  return lines.filter(line => line !== null).join('\n')
}
