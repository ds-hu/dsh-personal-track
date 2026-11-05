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
 * Tasks are the one cross-day registry that appears. The list carries every
 * unfinished task, whatever its deadline — the day it is due, a later one, or
 * none — each at its *current* progress and in the board's own order. It also
 * carries a finished task whose deadline is today or later: finishing today's
 * homework is part of today, and a report about the day should say so. A
 * finished task past its deadline has already sunk into the board's archive,
 * and one with no deadline says nothing about a day at all, so neither is listed.
 */
import type { ClockView, EquipmentSession, FreeSession, Meal, StateView } from '../types.ts'
import { mergeRope, ropeDurationText, ropeTempo } from '../../shared/rope.ts'
import { dayLabelOf, fractionText, moneyOf, paceLabel, paceOf, percentOf } from './format.ts'
import { byDeadline } from './task-order.ts'

/** A report line; `null` when the group has nothing worth a line. */
type Line = string | null

/** 日常: the two checks plus the laundry stock. */
function dailyLine(state: StateView): Line {
  const record = state.day.day
  const washes = record?.washes.times.length ?? 0
  const shower = record?.shower.at != null
  const parts = [`洗漱 ${washes}/2`, shower ? '洗澡 ✓' : '洗澡 —']
  if (state.stock.pending > 0) parts.push(`待洗 ${state.stock.pending} 件`)
  return parts.join(' · ')
}

/** The three meal slots in the day's own order, each with its price. */
const MEAL_SLOTS = [
  ['早', 'breakfast'],
  ['午', 'lunch'],
  ['晚', 'dinner'],
] as const

/**
 * 饮食: every slot named, so which meal is missing is readable rather than
 * counted. A slot recorded without a price shows ✓; the day's total is kept as
 * a tail for the figure the report used to carry alone.
 */
function mealsLine(state: StateView): Line {
  const meals = state.day.day?.meals ?? {}
  const spend = MEAL_SLOTS.reduce((sum, [, slot]) => sum + (meals[slot]?.price ?? 0), 0)
  const text = MEAL_SLOTS
    .map(([label, slot]) => {
      const meal: Meal | undefined = meals[slot]
      if (meal === undefined) return `${label} —`
      return `${label} ${meal.price === undefined ? '✓' : moneyOf(meal.price)}`
    })
    .join(' · ')
  return `三餐 ${text}${spend > 0 ? `（共 ${moneyOf(spend)}）` : ''}`
}

/** 学习: weighted vocabulary progress plus the day's lessons. */
function studyLine(state: StateView): Line {
  const vocab = state.day.vocab
  const percent = percentOf(vocab.ratio)
  const surplus = vocab.surplusNew + vocab.surplusReview
  const details = [
    `新 ${vocab.doneNew}/${vocab.targetNew}`,
    `复 ${vocab.doneReview}/${vocab.targetReview}`,
    ...(vocab.minutes > 0 ? [`${vocab.minutes} 分`] : []),
    ...(surplus > 0 ? [`超额 ${surplus}`] : []),
  ].join(' · ')
  const lessons = state.day.day?.duolingo ?? []
  const minutes = lessons.reduce((sum, lesson) => sum + lesson.minutes, 0)
  const duolingoText = lessons.length === 0
    ? '多邻国 —'
    : `多邻国 ${lessons.length} 节${minutes > 0 ? ` ${minutes} 分` : ''}`
  return `背单词 ${percent}%（${details}） · ${duolingoText}`
}

/** One set's seconds, so a timed habit reports every hold rather than a total. */
function secondsList(sets: readonly { readonly seconds: number }[]): string {
  return `${sets.map(set => set.seconds).join('+')} 秒`
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
function equipmentText(sets: readonly EquipmentSession[]): string {
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
    .map(({ name, weight, sets: count, reps }) =>
      `${name}${weight === undefined ? '' : ` ${weight}kg`} ${count} 组 ${reps} 次`)
    .join(' · ')
}

/** One free-form session's duration, in the same per-entry style as the others. */
function freeText(sessions: readonly FreeSession[]): string {
  const minutes = sessions.map(session => session.minutes).join('+')
  const measured = sessions.filter(session => session.kcal !== undefined)
  const kcal = measured.reduce((sum, session) => sum + (session.kcal ?? 0), 0)
  // A total burn that leaves out unmeasured sessions has to say so, or the
  // number reads as the whole day's. A comma rather than a second bracket: the
  // segment is already inside the duration's parentheses.
  const energy = measured.length === 0
    ? ''
    : measured.length === sessions.length
      ? ` · ${kcal} kcal`
      : ` · ${kcal} kcal，${measured.length}/${sessions.length} 次有记录`
  return `自由 ${sessions.length} 次（${minutes} 分${energy}）`
}

/**
 * 健身: only the training that happened gets a segment — but the line itself
 * always appears, so a rest day reads as a rest day.
 */
function fitnessLine(state: StateView): Line {
  const record = state.day.day
  const parts: string[] = []
  if (record !== null) {
    if (record.run !== null) {
      const pace = paceOf(record.run.minutes, record.run.distanceKm)
      parts.push(`跑步 ${record.run.distanceKm}km ${record.run.minutes} 分`
        + `${pace === undefined ? '' : ` ${paceLabel(pace)}`}`
        + `${record.run.avgHr === undefined ? '' : ` ♥${record.run.avgHr}`}`)
    }
    const rope = mergeRope(record.rope)
    if (rope !== null) {
      const tempo = ropeTempo(rope.count, rope.seconds)
      parts.push(`跳绳 ${rope.count} 个 ${ropeDurationText(rope.seconds)}`
        + `${tempo === undefined ? '' : ` ${fractionText(tempo)} 次/分`}`
        + `${rope.avgHr === undefined ? '' : ` ♥${rope.avgHr}`}`)
    }
    if (record.pullup.length > 0) {
      parts.push(`引体 ${record.pullup.length} 组（${secondsList(record.pullup)}）`)
    }
    if (record.plank.length > 0) {
      parts.push(`平板 ${record.plank.length} 组（${secondsList(record.plank)}）`)
    }
    if (record.equipment.length > 0) {
      parts.push(`器材 ${equipmentText(record.equipment)}`)
    }
    if (record.free.length > 0) {
      parts.push(freeText(record.free))
    }
  }
  return parts.length === 0 ? '健身 —' : parts.join(' · ')
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
function taskLines(state: StateView, clock: ClockView): Line {
  const listed = state.tasks
    .filter(task => task.state !== 'done' || (task.due !== undefined && task.due >= clock.today))
    .sort(byDeadline)
  if (listed.length === 0) return null
  const items = listed.map((task) => {
    const progress = task.progress.total === undefined
      ? ''
      : ` ${fractionText(task.progress.current)}/${fractionText(task.progress.total)}`
    const due = task.due === undefined ? '' : `（${dueMark(task.due)}${task.overdue ? ' 逾期' : ''}）`
    const finished = task.state === 'done' ? ' ✓' : ''
    return `- ${task.title}${task.category === undefined ? '' : `（${task.category}）`}${progress}${due}${finished}`
  })
  // The blank line keeps the list a list in renderers that will not let one
  // interrupt the paragraph above it.
  return `任务：\n\n${items.join('\n')}`
}

/** The whole report: a header, the completion figure, then one line per group. */
export function dayReport(state: StateView, clock: ClockView): string {
  const { day } = state
  const night = clock.nightTail && day.date === clock.today
  const percent = percentOf(day.progress.total === 0 ? 0 : day.progress.done / day.progress.total)
  const lines: Line[] = [
    `习惯日报 ${dayLabelOf(day.date, night)}`,
    `完成 ${fractionText(day.progress.done)}/${day.progress.total}（${percent}%）`,
    dailyLine(state),
    mealsLine(state),
    studyLine(state),
    fitnessLine(state),
    taskLines(state, clock),
  ]
  return lines.filter(line => line !== null).join('\n')
}
