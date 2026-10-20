/**
 * What the panel does with what focus mode hands back, and what the column does
 * with a pinned entry whose task is done.
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
 * - a pinned **task** that is done stops occupying the column, while media keeps
 *   its pin.
 *
 * Runs on Node's native type stripping:
 *   node tests/focus-panel.test.ts
 */
import { strict as assert } from 'node:assert'
import { pinShouldRetire, withEntry } from '../src/client/board/focus.ts'
import { createWriteQueue } from '../src/client/board/write-queue.ts'
import type { MediaEntry, StateView, TaskEntry } from '../src/client/types.ts'

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

/** A minimal slice: the two registries, plus a day the entry rules must not touch. */
const SLICE: StateView = {
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

console.log('when the column lets a pinned entry go')
await check('a completed task retires, a live one does not', () => {
  assert.equal(pinShouldRetire(SLICE.tasks[0] as TaskEntry), false, 'doing')
  assert.equal(pinShouldRetire(SLICE.tasks[1] as TaskEntry), false, 'todo')
  const done = taskOf({
    id: 't1',
    title: '线代作业',
    progress: { current: 20, total: 20 },
    checkpoints: [],
    createdAt: '2026-09-18T10:00:00',
    state: 'done',
    completedAt: '2026-09-20T21:00:00',
    overdue: false,
  })
  assert.equal(pinShouldRetire(done), true)
})

await check('media keeps its pin: finished business is not what this rule is about', () => {
  // A decision, not an oversight: the column is how a half-watched film is
  // picked up again, and only a task's derived 任务状态 retires it here.
  const finished = mediaOf({
    id: 'm1', kind: 'film', title: '流浪地球', status: 'done', createdAt: '2026-09-10T10:00:00',
  })
  const dropped = mediaOf({
    id: 'm2', kind: 'book', title: '三体', status: 'dropped', createdAt: '2026-09-10T10:00:00',
  })
  assert.equal(pinShouldRetire(finished), false)
  assert.equal(pinShouldRetire(dropped), false)
})

console.log(`\n${passed} checks passed`)
