/**
 * Client-side pure helpers: the date arithmetic and form defaults the board
 * computes before the host ever sees a value.
 *
 * Runs on Node's native type stripping, like the data-layer tests:
 *   node tests/client-format.test.ts
 *
 * Only modules free of JSX and of the DOM are imported here, so the browser
 * half's pure logic can be tested without a browser.
 */
import { strict as assert } from 'node:assert'
import {
  clockTimeOf,
  dueLevelOf,
  fractionText,
  formatCheckpoints,
  mediaStatusLabel,
  messageOf,
  parseCheckpoints,
  percentOf,
  TIME_FIELD,
  timeField,
  weekEndKey,
} from '../src/client/board/format.ts'
import { daysBetween, habitDayKey, shiftDayKey } from '../src/shared/habit-day.ts'
import { dayReport } from '../src/client/board/report.ts'
import { isEntryView } from '../src/client/board/focus.ts'
import type { ClockView, StateView, TaskEntry } from '../src/client/types.ts'

let passed = 0

/** Run one labelled case. */
function check(label: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

console.log('habit-day key arithmetic (one copy, shared by both halves)')
check('shifting crosses a month boundary', () => {
  assert.equal(shiftDayKey('2026-09-30', 4), '2026-10-04')
  assert.equal(shiftDayKey('2026-10-01', -1), '2026-09-30')
})

console.log('the end of the week (Monday-first, as the ranges are)')
check('every weekday resolves to the Sunday of its own week', () => {
  // 2026-09-14 is a Monday and 2026-09-20 the Sunday that closes that week.
  assert.equal(weekEndKey('2026-09-14'), '2026-09-20', 'Monday reaches the coming Sunday')
  assert.equal(weekEndKey('2026-09-16'), '2026-09-20', 'midweek')
  assert.equal(weekEndKey('2026-09-19'), '2026-09-20', 'Saturday')
  assert.equal(weekEndKey('2026-09-20'), '2026-09-20', 'Sunday is its own week end')
  assert.equal(weekEndKey('2026-09-21'), '2026-09-27', 'the next Monday starts a new week')
})
check('the week end can fall in the next month', () => {
  assert.equal(weekEndKey('2026-09-30'), '2026-10-04', 'a Wednesday in September ends in October')
})

console.log('new-entry time defaults')
check('the current clock time is a well-formed HH:mm', () => {
  assert.match(clockTimeOf(), /^([01]\d|2[0-3]):[0-5]\d$/)
})
check('the time field carries the current clock time as its default', () => {
  const field = timeField()
  assert.equal(field.name, 'time')
  assert.equal(field.kind, 'time')
  assert.match(String(field.defaultValue), /^([01]\d|2[0-3]):[0-5]\d$/)
  assert.equal(field.optional, undefined, 'time stays required, now that it arrives filled in')
})
check('the shared constant stays empty, so no default is frozen at import', () => {
  assert.equal(Object.hasOwn(TIME_FIELD, 'defaultValue'), false)
  assert.match(String(timeField().defaultValue), /^([01]\d|2[0-3]):[0-5]\d$/)
})

console.log('deadline proximity (the board colours it)')
check('day differences count whole days either way', () => {
  assert.equal(daysBetween('2026-09-16', '2026-09-16'), 0)
  assert.equal(daysBetween('2026-09-16', '2026-09-19'), 3)
  assert.equal(daysBetween('2026-09-16', '2026-09-15'), -1)
  assert.equal(daysBetween('2026-09-30', '2026-10-02'), 2, 'across a month boundary')
})
check('the bands are today, three days, a week, then beyond', () => {
  const today = '2026-09-16'
  assert.equal(dueLevelOf('2026-09-15', today), 'overdue', 'yesterday')
  assert.equal(dueLevelOf('2026-09-16', today), 'today')
  assert.equal(dueLevelOf('2026-09-17', today), 'soon')
  assert.equal(dueLevelOf('2026-09-19', today), 'soon', 'three days out is still soon')
  assert.equal(dueLevelOf('2026-09-20', today), 'week', 'four days out moves to a week')
  assert.equal(dueLevelOf('2026-09-23', today), 'week', 'seven days out is the edge')
  assert.equal(dueLevelOf('2026-09-24', today), 'far', 'eight days out is unremarkable')
})
check('a band is decided by the habit day, not by the calendar date', () => {
  // 01:30 on the 17th still belongs to the habit day of the 16th (night tail),
  // and that is the day the band must be measured from — the focus overlay used
  // to pass the local calendar date here and colour tomorrow's task as 今天.
  const nightTail = new Date('2026-09-17T01:30:00')
  const habitDay = habitDayKey(nightTail, { dayStartHour: 4 })
  assert.equal(habitDay, '2026-09-16')
  assert.equal(dueLevelOf('2026-09-17', habitDay), 'soon', 'due tomorrow is not due today')
  assert.equal(dueLevelOf('2026-09-17', '2026-09-17'), 'today', 'and the calendar date would have said otherwise')
})
check('with no habit day yet, nothing reads as urgent', () => {
  assert.equal(dueLevelOf('2026-09-16', ''), 'far', 'an unanswered clock must not paint every deadline red')
})
check('a fractional count keeps one decimal and drops a trailing .0', () => {  assert.equal(fractionText(5), '5')
  assert.equal(fractionText(5.25), '5.3', 'rounded to one decimal, not truncated')
  assert.equal(fractionText(4.0), '4')
  assert.equal(fractionText(0.5), '0.5')
})

console.log('percent (one owner for the board, the report and the stats panel)')
check('a ratio becomes whole percent', () => {
  assert.equal(percentOf(0), 0)
  assert.equal(percentOf(1), 100)
  assert.equal(percentOf(0.5), 50)
  assert.equal(percentOf(0.55), 55)
})
check('rounding is to the nearest whole percent', () => {
  assert.equal(percentOf(0.004), 0, 'below half a percent floors to zero')
  assert.equal(percentOf(0.005), 1, 'and half a percent rounds up')
  assert.equal(percentOf(0.994), 99)
  assert.equal(percentOf(0.995), 100)
})
check('a ratio is clamped, so a bar can never overflow or invert', () => {
  assert.equal(percentOf(-1), 0)
  assert.equal(percentOf(1.5), 100)
})
check('an uncomputable ratio reads as zero rather than NaN', () => {
  // The one case `report.ts` used to special-case by hand.
  assert.equal(percentOf(Number.NaN), 0)
  assert.equal(percentOf(Number.POSITIVE_INFINITY), 0, 'not a ratio, so not a percent')
})

console.log('media status labels')
check('the three known statuses are translated', () => {
  assert.equal(mediaStatusLabel('active'), '在列')
  assert.equal(mediaStatusLabel('done'), '完成')
  assert.equal(mediaStatusLabel('dropped'), '弃')
})
check('an unknown status falls back to itself rather than to blank', () => {
  assert.equal(mediaStatusLabel('owned'), 'owned')
})

console.log('failure text')
check('a host code is shown beside the message', () => {
  const failure = Object.assign(new Error('洗漱每日至多两次'), { code: 'habit/check-limit' })
  assert.equal(messageOf(failure), '洗漱每日至多两次（habit/check-limit）')
})
check('a plain error and a non-error both degrade sensibly', () => {
  assert.equal(messageOf(new Error('boom')), 'boom')
  assert.equal(messageOf('just a string'), 'just a string')
  assert.equal(messageOf(undefined), 'undefined')
})

console.log('the plain-text day report (what the copy button lands)')
const reportClock: ClockView = {
  today: '2026-09-20', nightTail: false, now: '2026-09-20T20:00:00',
  config: { dayStartHour: 4, defaultVocabTarget: { new: 20, review: 60 }, defaultRunMinutes: 30 },
}
const reportState: StateView = {
  day: {
    date: '2026-09-20', isToday: true,
    day: {
      date: '2026-09-20',
      washes: { times: ['2026-09-20T07:00:00', '2026-09-20T22:30:00'] },
      shower: { at: '2026-09-20T22:40:00' },
      meals: {
        breakfast: { at: '2026-09-20T08:00:00', price: 12 },
        lunch: { at: '2026-09-20T12:00:00', price: 24.5 },
      },
      vocab: {
        target: { new: 20, review: 60 },
        sessions: [{ id: 'v1', at: '2026-09-20T07:12:00', new: 5, review: 30, minutes: 45 }],
      },
      duolingo: [{ id: 'd1', at: '2026-09-20T09:00:00', minutes: 25 }],
      rope: [{ id: 'r1', at: '2026-09-20T10:00:00', preset: 90, seconds: 60 }],
      pullup: [
        { id: 'u1', at: '2026-09-20T10:20:00', seconds: 40 },
        { id: 'u2', at: '2026-09-20T10:25:00', seconds: 35 },
        { id: 'u3', at: '2026-09-20T10:30:00', seconds: 30 },
      ],
      plank: [
        { id: 'k1', at: '2026-09-20T10:40:00', seconds: 60 },
        { id: 'k2', at: '2026-09-20T10:45:00', seconds: 45 },
      ],
      equipment: [
        { id: 'g1', at: '2026-09-20T11:00:00', name: '卧推', reps: 10, weight: 40 },
        { id: 'g2', at: '2026-09-20T11:05:00', name: '卧推', reps: 8, weight: 40 },
        { id: 'g3', at: '2026-09-20T11:10:00', name: '卧推', reps: 6, weight: 50 },
        { id: 'g4', at: '2026-09-20T11:15:00', name: '深蹲', reps: 12 },
      ],
      run: { at: '2026-09-20T18:00:00', minutes: 30, distanceKm: 5, avgHr: 156 },
      washing: [],
    },
    target: { new: 20, review: 60 },
    // 5 new + 30 reviews at a fifth = 11/20 → 55%.
    vocab: {
      doneNew: 5, doneReview: 30, targetNew: 20, targetReview: 60,
      minutes: 45, ratio: 0.55, surplusNew: 0, surplusReview: 0, met: false,
    },
    cells: [],
    progress: { done: 4.5, total: 9 },
  },
  stock: { pending: 4, updatedAt: '2026-09-19T12:00:00' },
  media: [],
  tasks: [
    taskOf({ id: 't3', title: '交房租', due: '2026-09-15', progress: { current: 0 }, checkpoints: [], createdAt: '2026-09-10T10:00:00', state: 'todo', overdue: true }),
    taskOf({ id: 't1', title: '英语口语', category: '英听说 A', due: '2026-09-20', progress: { current: 2, total: 5 }, checkpoints: [], createdAt: '2026-09-18T10:00:00', state: 'doing', overdue: false }),
    taskOf({ id: 't2', title: '高数作业', due: '2026-09-24', progress: { current: 0, total: 1 }, checkpoints: [], createdAt: '2026-09-19T10:00:00', state: 'todo', overdue: false }),
    taskOf({ id: 't4', title: '读书笔记', due: '2026-09-20', progress: { current: 3, total: 3 }, checkpoints: [], createdAt: '2026-09-17T10:00:00', state: 'done', completedAt: '2026-09-20T21:00:00', overdue: false }),
  ],
}
/**
 * One task as the report sees it.
 *
 * `dayReport` reads a task's title, category, deadline and progress and nothing
 * else, so the fields that materials and focus mode added are filled in here
 * rather than repeated in every fixture below — and a field the report *did*
 * read would have to be stated on purpose.
 */
function taskOf(entry: Omit<TaskEntry, 'materials' | 'focusSessions' | 'focusSeconds'>): TaskEntry {
  return { materials: [], focusSessions: [], focusSeconds: 0, ...entry }
}

const reportText = dayReport(reportState, reportClock)
check('the header names the day (or the night tail) and the completion figure', () => {
  assert.ok(reportText.startsWith('习惯日报 9月20日 周日\n'), reportText.split('\n')[0])
  assert.ok(reportText.includes('完成 4.5/9（50%）'), reportText.split('\n')[1])
  const nightClock = { ...reportClock, nightTail: true }
  assert.ok(dayReport(reportState, nightClock).includes('9月20日 周日夜'))
})
check('each group is one line, with the details it used to drop', () => {
  assert.ok(reportText.includes('洗漱 2/2 · 洗澡 ✓ · 待洗 4 件'))
  assert.ok(reportText.includes('三餐 早 ¥12 · 午 ¥24.5 · 晚 —（共 ¥36.5）'), 'every slot is named, missing one included')
  assert.ok(reportText.includes('背单词 55%（新 5/20 · 复 30/60 · 45 分） · 多邻国 1 节 25 分'))
  assert.ok(reportText.includes(`跑步 5km 30 分 6'00"/km ♥156`))
  assert.ok(reportText.includes('跳绳 1 组（90×1）'))
  assert.ok(reportText.includes('引体 3 组（40+35+30 秒）'), 'every set shows its own support time')
  assert.ok(reportText.includes('平板 2 组（60+45 秒）'), 'every hold shows its own seconds')
  assert.ok(
    reportText.includes('器材 卧推 40kg 2 组 18 次 · 卧推 50kg 1 组 6 次 · 深蹲 1 组 12 次'),
    'the weight is kept, and only an identical load merges',
  )
})
check('tasks: every unfinished task is named, one Markdown list item each', () => {
  assert.ok(
    reportText.includes('剩余任务：\n\n- 交房租（逾期）\n- 英语口语（英听说 A） 2/5\n- 高数作业 0/1（9-24）'),
    reportText,
  )
  assert.ok(!reportText.includes('读书笔记'), 'a finished task is not remaining')
})
check('the remaining-task list reads in the board\'s order: deadline ascending, undated last', () => {
  // Handed over shuffled — what the report must not do is echo the arrival
  // order, which is neither the tile's nor "most urgent first".
  const shuffled: StateView = {
    ...reportState,
    tasks: [
      taskOf({ id: 't5', title: '修台灯', progress: { current: 0 }, checkpoints: [], createdAt: '2026-09-11T10:00:00', state: 'todo', overdue: false }),
      taskOf({ id: 't2', title: '高数作业', due: '2026-09-24', progress: { current: 0, total: 1 }, checkpoints: [], createdAt: '2026-09-19T10:00:00', state: 'todo', overdue: false }),
      taskOf({ id: 't4', title: '读书笔记', due: '2026-09-20', progress: { current: 3, total: 3 }, checkpoints: [], createdAt: '2026-09-17T10:00:00', state: 'done', completedAt: '2026-09-20T21:00:00', overdue: false }),
      taskOf({ id: 't6', title: '买菜', progress: { current: 0 }, checkpoints: [], createdAt: '2026-09-19T18:00:00', state: 'todo', overdue: false }),
      taskOf({ id: 't3', title: '交房租', due: '2026-09-15', progress: { current: 0 }, checkpoints: [], createdAt: '2026-09-10T10:00:00', state: 'todo', overdue: true }),
      taskOf({ id: 't1', title: '英语口语', category: '英听说 A', due: '2026-09-20', progress: { current: 2, total: 5 }, checkpoints: [], createdAt: '2026-09-18T10:00:00', state: 'doing', overdue: false }),
    ],
  }
  const tail = dayReport(shuffled, reportClock).split('剩余任务：\n\n')[1]
  assert.equal(
    tail,
    [
      '- 交房租（逾期）',
      '- 英语口语（英听说 A） 2/5',
      '- 高数作业 0/1（9-24）',
      '- 买菜',
      '- 修台灯',
    ].join('\n'),
    'due soonest first, undated last (newest first among them)',
  )
})
check('an empty day still reports its zeros, and keeps every group line', () => {
  const empty: StateView = {
    ...reportState,
    day: {
      ...reportState.day,
      day: null,
      vocab: {
        doneNew: 0, doneReview: 0, targetNew: 20, targetReview: 60,
        minutes: 0, ratio: 0, surplusNew: 0, surplusReview: 0, met: false,
      },
      progress: { done: 0, total: 8 },
    },
    tasks: [],
  }
  const bare = dayReport(empty, reportClock)
  assert.ok(bare.includes('完成 0/8（0%）'))
  assert.ok(bare.includes('洗漱 0/2 · 洗澡 —'))
  assert.ok(bare.includes('三餐 早 — · 午 — · 晚 —'), 'the slots are named even when empty')
  assert.ok(bare.includes('健身 —'), 'a rest day keeps its line instead of vanishing')
  assert.ok(!bare.includes('跑步'))
  assert.ok(!bare.includes('剩余任务'), 'nothing open, no remaining-task line')
})

console.log('checkpoint lines (a task\'s stages in the editor)')
check('formatting sorts by position and joins one per line', () => {
  assert.equal(
    formatCheckpoints([{ label: '第二章', at: 20 }, { label: '第一章', at: 10 }]),
    '第一章@10\n第二章@20',
  )
})
check('parsing takes the last @ as the separator and skips blank lines', () => {
  assert.deepEqual(parseCheckpoints('第一章@10\n\n晚自习@3@20'), {
    list: [{ label: '第一章', at: 10 }, { label: '晚自习@3', at: 20 }],
  })
})
check('a line that is not label@position is a problem, not a guess', () => {
  assert.equal(parseCheckpoints('第一章 10').problem, '检查点第 1 行要形如「第一章@10」')
  assert.equal(parseCheckpoints('@10').problem, '检查点第 1 行要形如「第一章@10」')
  assert.equal(parseCheckpoints('第一章@').problem, '检查点第 1 行要形如「第一章@10」')
  assert.equal(parseCheckpoints('第一章@0').problem, '检查点第 1 行要形如「第一章@10」')
  assert.equal(parseCheckpoints('第一章@2.5').problem, '检查点第 1 行要形如「第一章@10」')
  assert.equal(parseCheckpoints('第一章@10\n坏行').problem, '检查点第 2 行要形如「第一章@10」')
})
check('an empty textarea is an empty list, never a problem', () => {
  assert.deepEqual(parseCheckpoints(''), { list: [] })
  assert.deepEqual(parseCheckpoints(' \n\n'), { list: [] })
})

console.log('what a registry answer must be before focus mode adopts it')
check('only a view is adoptable, never the stored record', () => {
  // The view: what `/state` lists and what every registry write answers with —
  // an image material with the mime its asset gives it, and a derived total.
  const view = taskOf({
    id: 't1',
    title: '线代作业',
    progress: { current: 0, total: 10 },
    checkpoints: [],
    createdAt: '2026-09-16T11:00:00',
    state: 'todo',
    overdue: false,
  })
  assert.equal(isEntryView(view), true)

  // The same task as storage holds it. Nothing here is missing by accident: a
  // record has no derived fields, and its image material is only a reference —
  // adopting one is what drew every image as "图片缺失" and the focus total as
  // NaN the moment the progress bar was dragged in focus mode.
  const record = {
    id: 't1',
    title: '线代作业',
    progress: { current: 0, total: 10 },
    checkpoints: [],
    createdAt: '2026-09-16T11:00:00',
    materials: [{ kind: 'image', id: 'm1', assetId: 'a1', createdAt: '2026-09-16T11:01:00' }],
    focusSessions: [],
  }
  assert.equal(isEntryView(record), false, 'a stored record is not an entry view')

  assert.equal(isEntryView(undefined), false)
  assert.equal(isEntryView(null), false)
  assert.equal(isEntryView('entry'), false)
})

console.log(`\n${passed} checks passed`)
