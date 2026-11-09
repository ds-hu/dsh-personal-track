/**
 * What the panel does with what focus mode hands back, and what the focus
 * column's card is derived from.
 *
 * Both defects these guard live in a component's wiring, which this repo cannot
 * render in Node — so the load-bearing parts were pulled out into pure rules and
 * are asserted directly:
 *
 * - focus mode's writes run **one at a time**, so issue order, apply order and
 *   answer order are the same order (an out-of-order answer used to be adopted
 *   as the truth, and the next `+1` was then computed from it);
 * - leaving the mode waits for them (`settled`), so the board's re-read cannot
 *   race the last write;
 * - the entry handed back is adopted into the panel's slice instead of dropped;
 * - the column's "focused on" list is ordered by the newest **closed** session,
 *   not by total time: it answers "what was I just doing", while the total is a
 *   quantity and belongs on the row.
 *
 * Runs on Node's native type stripping:
 *   node tests/focus-panel.test.ts
 */
import { strict as assert } from 'node:assert'
import { focusSeconds } from '../src/shared/focus-session.ts'
import { byRecentFocus, lastFocusAt, withEntry } from '../src/client/board/focus.ts'
import { createWriteQueue } from '../src/client/board/write-queue.ts'
import type { FocusSession, MediaEntry, StateView, TaskEntry } from '../src/client/types.ts'

let passed = 0

/** Run one labelled case. */
function check(label: string, fn: () => void | Promise<void>): Promise<void> | void {
  const done = (): void => {
    passed += 1
    console.log(`  ✓ ${label}`)
  }
  const result = fn()
  return result instanceof Promise ? result.then(done) : done()
}

/** A little pause, so "the writes ran in order" is observable rather than guessed. */
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** One task as the state slice carries it. */
function taskOf(entry: Omit<TaskEntry, 'materials' | 'focusSessions' | 'focusSeconds'>): TaskEntry {
  return { materials: [], focusSessions: [], focusSeconds: 0, ...entry }
}

/** One media entry as the state slice carries it. */
function mediaOf(entry: Omit<MediaEntry, 'materials' | 'focusSessions' | 'focusSeconds'>): MediaEntry {
  return { materials: [], focusSessions: [], focusSeconds: 0, ...entry }
}

/** One closed focus session. */
function closed(id: string, startedAt: string, endedAt: string): FocusSession {
  return { id, startedAt, endedAt }
}

/** A task entry carrying these focus sessions, with the total the host derives. */
function taskFocusing(id: string, state: TaskEntry['state'], sessions: readonly FocusSession[]): TaskEntry {
  return {
    ...taskOf({
      id,
      title: id,
      progress: { current: 0 },
      checkpoints: [],
      createdAt: '2026-09-18T10:00:00',
      state,
      overdue: false,
    }),
    focusSessions: sessions,
    focusSeconds: focusSeconds(sessions),
  }
}

/** A media entry carrying these focus sessions. */
function mediaFocusing(id: string, sessions: readonly FocusSession[]): MediaEntry {
  return {
    ...mediaOf({ id, kind: 'film', title: id, status: 'active', createdAt: '2026-09-10T10:00:00' }),
    focusSessions: sessions,
    focusSeconds: focusSeconds(sessions),
  }
}

/** A minimal slice: the three registries, plus a day the entry rules must not touch. */
const SLICE: StateView = {
  todos: [],
  day: {
    date: '2026-09-20',
    isToday: true,
    day: null,
    target: { new: 20, review: 60 },
    vocab: {
      doneNew: 0, doneReview: 0, targetNew: 20, targetReview: 60,
      minutes: 0, ratio: 0, surplusNew: 0, surplusReview: 0, met: false,
    },
    cells: [],
    progress: { done: 0, total: 8 },
  },
  stock: { pending: 0, updatedAt: '2026-09-20T08:00:00' },
  media: [
    mediaOf({
      id: 'm1',
      kind: 'film',
      title: '流浪地球',
      status: 'active',
      createdAt: '2026-09-10T10:00:00',
    }),
  ],
  tasks: [
    taskOf({
      id: 't1',
      title: '线代作业',
      due: '2026-09-20',
      progress: { current: 14, total: 20 },
      checkpoints: [],
      createdAt: '2026-09-18T10:00:00',
      state: 'doing',
      overdue: false,
    }),
    taskOf({
      id: 't2',
      title: '交房租',
      progress: { current: 0 },
      checkpoints: [],
      createdAt: '2026-09-11T10:00:00',
      state: 'todo',
      overdue: false,
    }),
  ],
}

console.log('the write queue: one at a time, in issue order')
await check('writes never overlap, and run in the order they were issued', async () => {
  const queue = createWriteQueue()
  let running = false
  const started: string[] = []
  /** One write that fails if another is still in flight. */
  const write = (label: string): Promise<string> => queue.run(async () => {
    assert.equal(running, false, `${label} started while another write was still running`)
    running = true
    started.push(label)
    await tick()
    running = false
    return label
  })
  const answers = await Promise.all([write('14'), write('17'), write('20')])
  assert.deepEqual(started, ['14', '17', '20'], 'started in issue order, not in answer order')
  assert.deepEqual(answers, ['14', '17', '20'], 'and every caller still gets its own answer')
})

await check('a refused write does not wedge the ones queued behind it', async () => {
  const queue = createWriteQueue()
  const failure = queue.run(async () => {
    await tick()
    throw new Error('宿主拒绝了这次写')
  })
  const after = queue.run(async () => '仍然执行')
  await assert.rejects(() => failure, /宿主拒绝了这次写/)
  assert.equal(await after, '仍然执行', 'the next write still runs')
  await queue.settled() // must not reject with the first write's failure
})

await check('settled() waits for whatever is still queued', async () => {
  const queue = createWriteQueue()
  let landed = false
  void queue.run(async () => {
    await tick()
    landed = true
  })
  assert.equal(landed, false, 'the write has not landed yet')
  await queue.settled()
  assert.equal(landed, true, 'settled() resolved only once it had')
})

await check('an idle queue is settled immediately', async () => {
  await createWriteQueue().settled()
})

await check('a failed write is still waited for, and settled() never rejects', async () => {
  const queue = createWriteQueue()
  void queue.run(async () => {
    await tick()
    throw new Error('拒绝')
  })
  await queue.settled()
})

console.log('adopting the entry focus mode hands back')
await check('a task view replaces the task in the slice, and nothing else', () => {
  const answered = taskOf({
    id: 't1',
    title: '线代作业',
    due: '2026-09-20',
    progress: { current: 20, total: 20 },
    checkpoints: [],
    createdAt: '2026-09-18T10:00:00',
    state: 'done',
    completedAt: '2026-09-20T21:00:00',
    overdue: false,
  })
  const next = withEntry(SLICE, answered)
  assert.equal(next.tasks.find(task => task.id === 't1'), answered, 'the answered view is adopted whole')
  assert.equal(next.tasks.find(task => task.id === 't2'), SLICE.tasks[1], 'the other task is the very same object')
  assert.equal(next.media, SLICE.media, 'the media list is untouched')
  assert.equal(next.day, SLICE.day, 'the shown day is not the panel\'s business')
  assert.equal(next.stock, SLICE.stock)
})

await check('a media view replaces the entry in its own list', () => {
  const answered = mediaOf({
    id: 'm1',
    kind: 'film',
    title: '流浪地球',
    status: 'done',
    rating: 5,
    createdAt: '2026-09-10T10:00:00',
  })
  const next = withEntry(SLICE, answered)
  assert.equal(next.media[0], answered)
  assert.equal(next.tasks, SLICE.tasks, 'the task list is untouched')
})

await check('an entry the slice does not hold leaves it exactly as it was', () => {
  // A snapshot taken before the entry was added: inventing a slot for it would
  // show it in a list the host never put it in, and the caller's re-read is what
  // fills it in.
  const stranger = taskOf({
    id: 't9',
    title: '刚建的任务',
    progress: { current: 0 },
    checkpoints: [],
    createdAt: '2026-09-20T12:00:00',
    state: 'todo',
    overdue: false,
  })
  assert.equal(withEntry(SLICE, stranger), SLICE, 'the same slice back, not an empty rebuild')
})

console.log('what the column’s "focused on" list is ordered by')

await check('most recently worked on first, across both registries', () => {
  const task = taskFocusing('t1', 'doing', [closed('a', '2026-09-20T09:00:00.000Z', '2026-09-20T09:30:00.000Z')])
  const media = mediaFocusing('m1', [
    closed('b', '2026-09-20T11:00:00.000Z', '2026-09-20T11:20:00.000Z'),
    { id: 'open', startedAt: '2026-09-20T12:00:00.000Z' },
  ])
  const ordered = [task, media].sort(byRecentFocus)
  assert.deepEqual(
    ordered.map(entry => entry.id),
    ['m1', 't1'],
    'the newer session leads, whichever registry it sits in',
  )
})

await check('total time does not decide the order', () => {
  // Two hours two days ago versus ten minutes just now: the ten minutes lead,
  // because the list answers "what was I just doing", not "what did I do most".
  const longAgo = taskFocusing('t1', 'doing', [
    closed('a', '2026-09-18T09:00:00.000Z', '2026-09-18T11:00:00.000Z'),
  ])
  const justNow = mediaFocusing('m1', [
    closed('b', '2026-09-20T11:55:00.000Z', '2026-09-20T12:05:00.000Z'),
  ])
  assert.ok(justNow.focusSeconds < longAgo.focusSeconds, 'the fixtures really are the wrong way round by time')
  assert.deepEqual([longAgo, justNow].sort(byRecentFocus).map(entry => entry.id), ['m1', 't1'])
})

await check('an open session orders nothing, and ties keep the order they came in', () => {
  const idle = taskFocusing('t1', 'todo', [])
  const openOnly = mediaFocusing('m1', [{ id: 'open', startedAt: '2026-09-20T12:00:00.000Z' }])
  const focused = taskFocusing('t2', 'doing', [closed('c', '2026-09-20T09:00:00.000Z', '2026-09-20T09:30:00.000Z')])
  assert.deepEqual(
    [idle, openOnly, focused].sort(byRecentFocus).map(entry => entry.id),
    ['t2', 't1', 'm1'],
    'the entry with a closed session leads; the two with none keep their input order',
  )
  assert.equal(lastFocusAt(idle), Number.NEGATIVE_INFINITY, 'never focused on is not a time')
  assert.equal(lastFocusAt(openOnly), Number.NEGATIVE_INFINITY, 'and an open session is not a fact yet')
})

console.log(`\n${passed} checks passed`)
