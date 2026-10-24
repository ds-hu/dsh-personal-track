/**
 * The habit store: every mutation rule, against an in-memory domain.
 *
 * `store.ts` holds the rules that are hardest to get right and were previously
 * reachable only through a real HTTP call against real storage —
 * `docs/adr/0002-derived-state-not-stored.md` calls out forward inheritance by
 * name and it had no unit test. The store takes a `Domain`, so a map-backed one
 * (tests/support.ts) is enough to assert all of it in-process.
 *
 * Runs on Node's native type stripping:
 *   node tests/store.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker, fixedClock, memoryDomain, testConfig } from './support.ts'
import { createHabitStore, type HabitStore } from '../src/host/store.ts'

const checker = createChecker('the habit store')
const { check, checkAsync, report } = checker

const DATE = '2026-09-16'
const NEXT = '2026-09-17'

/** A store over a fresh in-memory domain, plus the clock it stamps with. */
function storeAt(at = '2026-09-16T12:00:00Z'): { store: HabitStore; now: () => Date } {
  const now = fixedClock(at)
  return { store: createHabitStore(memoryDomain(), testConfig({ now })), now }
}

// --- untouched days ----------------------------------------------------------

check('an untouched day has no stored document and reads as empty', () => {
  const { store } = storeAt()
  assert.equal(store.readDay(DATE), undefined, 'reading must never create a document')
  const facts = store.dayFacts(DATE)
  assert.equal(facts.stored, null, 'and the caller is told the day is unbacked')
  assert.equal(facts.day.date, DATE)
  assert.deepEqual(facts.progress, { done: 0, total: 8 })
  assert.equal(facts.perfect, false)
})

check('the day the UI sees is filled with the effective target, not stored', () => {
  const { store } = storeAt()
  const facts = store.dayFacts(DATE)
  assert.deepEqual(facts.day.vocab, { target: { new: 20, review: 60 }, sessions: [] })
  assert.equal(store.readDay(DATE), undefined, 'the fill-in is a view, not a write')
})

// --- forward inheritance -----------------------------------------------------

check('with no history the target falls back to the config default', () => {
  const { store } = storeAt()
  assert.deepEqual(store.resolveTarget(DATE), { new: 20, review: 60 })
})

await checkAsync('a target snapshot is carried forward from the most recent earlier day', async () => {
  const { store } = storeAt()
  await store.setVocabTarget('2026-09-10', { new: 5, review: 5 })
  await store.setVocabTarget('2026-09-14', { new: 9, review: 9 })
  assert.deepEqual(store.resolveTarget(DATE), { new: 9, review: 9 }, 'the nearest earlier snapshot wins')
  // The walk starts at the day being asked about, so a day between two
  // snapshots sees the earlier one — not the later one.
  assert.deepEqual(store.resolveTarget('2026-09-12'), { new: 5, review: 5 }, 'a gap resolves backwards')
  assert.deepEqual(store.resolveTarget('2026-09-09'), { new: 20, review: 60 }, 'before any snapshot, the config default')
})

await checkAsync('inheriting does not write a document for the inheriting day', async () => {
  const { store } = storeAt()
  await store.setVocabTarget('2026-09-10', { new: 5, review: 5 })
  assert.equal(store.readDay(DATE), undefined, 'carry-forward is a read, not a materialization')
})

await checkAsync('a day holding its own snapshot is never rewritten by the rules', async () => {
  const { store } = storeAt()
  await store.setVocabTarget(DATE, { new: 3, review: 3 })
  await store.setVocabTarget('2026-09-20', { new: 99, review: 99 })
  // An earlier snapshot appearing later must not travel backwards into a day
  // that already decided its own target — that is "backfill changes nothing
  // after it".
  assert.deepEqual(store.resolveTarget(DATE), { new: 3, review: 3 })
})

// --- sessions ----------------------------------------------------------------

await checkAsync('sessions append with a stable id and patch in place', async () => {
  const { store, now } = storeAt()
  const first = await store.addSession(DATE, 'vocab', { at: 'x', new: 1, review: 2, minutes: 3 })
  const id = first.vocab!.sessions[0]!.id
  assert.ok(id, 'the store assigns the id')

  await store.patchSession(DATE, 'vocab', id, { minutes: 45 })
  const after = store.readDay(DATE)!
  assert.equal(after.vocab!.sessions.length, 1, 'a patch appends nothing')
  assert.equal(after.vocab!.sessions[0]!.id, id, 'and keeps the id')
  assert.equal(after.vocab!.sessions[0]!.minutes, 45)
  assert.equal(after.vocab!.sessions[0]!.new, 1, 'untouched fields survive')

  await store.removeSession(DATE, 'vocab', id)
  assert.equal(store.readDay(DATE)!.vocab!.sessions.length, 0)
  void now
})

await checkAsync('adding a session does not disturb its own target snapshot', async () => {
  const { store } = storeAt()
  await store.setVocabTarget(DATE, { new: 7, review: 7 })
  await store.addSession(DATE, 'vocab', { at: 'x', new: 1, review: 1, minutes: 1 })
  assert.deepEqual(store.resolveTarget(DATE), { new: 7, review: 7 })
})

await checkAsync('each session kind has its own array', async () => {
  const { store } = storeAt()
  await store.addSession(DATE, 'duolingo', { at: 'x', minutes: 5 })
  await store.addSession(DATE, 'rope', { at: 'x', preset: 90, seconds: 30 })
  await store.addSession(DATE, 'pullup', { at: 'x', seconds: 20 })
  await store.addSession(DATE, 'plank', { at: 'x', seconds: 45 })
  await store.addSession(DATE, 'equipment', { at: 'x', name: '划船机', reps: 10 })
  await store.addSession(DATE, 'washing', { at: 'x', pieces: 2 })
  const day = store.readDay(DATE)!
  assert.equal(day.duolingo.length, 1)
  assert.equal(day.rope.length, 1)
  assert.equal(day.pullup.length, 1)
  assert.equal(day.plank.length, 1)
  assert.equal(day.equipment.length, 1)
  assert.equal(day.washing.length, 1)
})

// --- the laundry pair --------------------------------------------------------

await checkAsync('a wash records the event first and then lowers the stock', async () => {
  const { store } = storeAt()
  await store.setStock(5, 'x')
  const { day, stock } = await store.wash(DATE, 3, '2026-09-16T20:00:00Z')
  assert.equal(day.washing.length, 1, 'the fact is recorded')
  assert.equal(day.washing[0]!.pieces, 3)
  assert.deepEqual(stock, { pending: 2, updatedAt: '2026-09-16T20:00:00Z' })
})

await checkAsync('the stock never goes negative on an oversized wash', async () => {
  const { store } = storeAt()
  await store.setStock(2, 'x')
  const { stock } = await store.wash(DATE, 10, 'y')
  assert.equal(stock.pending, 0, 'clamped at zero rather than negative')
})

await checkAsync('a stock correction leaves no history behind', async () => {
  const { store } = storeAt()
  await store.setStock(7, 'x')
  assert.equal(store.readDay(DATE), undefined, 'correcting the gauge is not an event')
})

check('an unset stock reads as zero at the epoch', () => {
  const { store } = storeAt()
  assert.deepEqual(store.view(DATE, DATE).stock, { pending: 0, updatedAt: new Date(0).toISOString() })
})

// --- tasks -------------------------------------------------------------------

await checkAsync('task progress merges field by field and follows completion', async () => {
  const { store } = storeAt()
  const created = await store.putTask({
    id: 't1', title: '作业', progress: { current: 0 }, createdAt: 'c',
  } as never)
  void created
  const doing = await store.patchTask('t1', { progress: { current: 3, total: 5 } })
  assert.deepEqual(doing.progress, { current: 3, total: 5 })
  assert.equal(store.view(DATE, DATE).tasks[0]!.state, 'doing')

  const merged = await store.patchTask('t1', { progress: { current: 4 } })
  assert.equal(merged.progress.total, 5, 'the total is not lost when only current is patched')
})

await checkAsync('completion stamps an instant and reopening clears it', async () => {
  const { store } = storeAt()
  await store.putTask({ id: 't1', title: '作业', progress: { current: 0, total: 2 }, createdAt: 'c' } as never)
  const done = await store.patchTask('t1', { progress: { current: 2 } })
  assert.equal(typeof done.completedAt, 'string', 'reaching the target is a fact with a time')
  const reopened = await store.patchTask('t1', { progress: { current: 1 } })
  assert.equal(reopened.completedAt, undefined, 'reopening removes the instant, not just the state')
})

await checkAsync('the stamped instant comes from the configured clock, not the wall clock', async () => {
  // The store derives completion, so it is where "now" is actually consulted.
  // Reaching for `new Date()` here would put a second clock in the plugin and
  // make every derived instant non-deterministic.
  const pinned = '2026-09-16T12:00:00.000Z'
  const { store } = storeAt(pinned)
  await store.putTask({ id: 't1', title: '作业', progress: { current: 0, total: 1 }, createdAt: 'c' } as never)
  const task = await store.patchTask('t1', { progress: { current: 1 } })
  assert.equal(task.completedAt, pinned)

  await store.putMedia({ id: 'm1', kind: 'film', title: '电影', status: 'active', createdAt: 'c' } as never)
  const media = await store.patchMedia('m1', { status: 'done' })
  assert.equal(media.finishedAt, pinned, 'the media instant uses the same clock')
})

await checkAsync('null clears an optional task field and undefined leaves it', async () => {
  const { store } = storeAt()
  await store.putTask({ id: 't1', title: '作业', due: '2026-09-20', category: '数学', createdAt: 'c' } as never)
  const untouched = await store.patchTask('t1', { title: '作业二' })
  assert.equal(untouched.due, '2026-09-20', 'an absent key leaves the field alone')
  const cleared = await store.patchTask('t1', { due: null, category: null })
  assert.equal(cleared.due, undefined)
  assert.equal(cleared.category, undefined)
})

await checkAsync('a task due on a day is a cell on that day only', async () => {
  const { store } = storeAt()
  await store.putTask({ id: 't1', title: '今日作业', due: DATE, progress: { current: 1, total: 4 }, createdAt: 'c' } as never)
  const due = store.dayFacts(DATE)
  assert.equal(due.progress.total, 9, 'the bar grows by one')
  assert.equal(due.cells.at(-1)!.id, 'task:t1')
  assert.equal(due.cells.at(-1)!.value, 0.25)
  assert.equal(store.dayFacts(NEXT).progress.total, 8, 'another day is untouched')
})

await checkAsync('the cell reads the task current state, not how it stood that day', async () => {
  const { store } = storeAt()
  await store.putTask({ id: 't1', title: '作业', due: DATE, progress: { current: 0, total: 4 }, createdAt: 'c' } as never)
  assert.equal(store.dayFacts(DATE).cells.at(-1)!.value, 0)
  await store.patchTask('t1', { progress: { current: 4 } })
  assert.equal(store.dayFacts(DATE).cells.at(-1)!.value, 1, 'finishing today fills today\'s square')
})

await checkAsync('due tasks on one day are ordered by title', async () => {
  const { store } = storeAt()
  // Titles order by code unit, which is what the store's comparator promises;
  // this is only about the cell order being stable, not about collation.
  await store.putTask({ id: 'b', title: 'beta', due: DATE, progress: { current: 0 }, createdAt: 'c' } as never)
  await store.putTask({ id: 'a', title: 'alpha', due: DATE, progress: { current: 0 }, createdAt: 'c' } as never)
  const labels = store.dayFacts(DATE).cells.slice(8).map(cell => cell.label)
  assert.deepEqual(labels, ['alpha', 'beta'])
})

await checkAsync('hard deleting a task takes its cell with it', async () => {
  const { store } = storeAt()
  await store.putTask({ id: 't1', title: '作业', due: DATE, progress: { current: 0 }, createdAt: 'c' } as never)
  assert.equal(store.dayFacts(DATE).progress.total, 9)
  assert.equal(await store.deleteTask('t1'), true)
  assert.equal(store.dayFacts(DATE).progress.total, 8)
})

// --- task checkpoints --------------------------------------------------------

await checkAsync('crossing a checkpoint stamps an instant; dropping back clears it', async () => {
  const { store } = storeAt()
  await store.putTask({
    id: 't1', title: '作业', progress: { current: 0, total: 30 },
    checkpoints: [{ id: 'c1', label: '第一章', at: 10 }, { id: 'c2', label: '第二章', at: 20 }],
    createdAt: 'c',
  } as never)
  const crossed = await store.patchTask('t1', { progress: { current: 12 } })
  assert.equal(typeof crossed.checkpoints[0]!.reachedAt, 'string', 'crossing a stage is a fact with a time')
  assert.equal(crossed.checkpoints[1]!.reachedAt, undefined, 'the stage still ahead keeps nothing')
  const back = await store.patchTask('t1', { progress: { current: 5 } })
  assert.equal(back.checkpoints[0]!.reachedAt, undefined, 'dropping below the threshold takes the instant back')
  const again = await store.patchTask('t1', { progress: { current: 30 } })
  assert.equal(typeof again.checkpoints[0]!.reachedAt, 'string', 're-crossing stamps anew')
  assert.equal(typeof again.checkpoints[1]!.reachedAt, 'string', 'and a jump crosses every stage it passes')
})

await checkAsync('the stamped checkpoint instants come from the configured clock', async () => {
  const pinned = '2026-09-16T12:00:00.000Z'
  const { store } = storeAt(pinned)
  await store.putTask({
    id: 't1', title: '作业', progress: { current: 0, total: 30 },
    checkpoints: [{ id: 'c1', label: '第一章', at: 10 }],
    createdAt: 'c',
  } as never)
  const crossed = await store.patchTask('t1', { progress: { current: 12 } })
  assert.equal(crossed.checkpoints[0]!.reachedAt, pinned)
})

await checkAsync('a task created past a stage records when it was registered', async () => {
  const pinned = '2026-09-16T12:00:00.000Z'
  const { store } = storeAt(pinned)
  await store.putTask({
    id: 't1', title: '作业', progress: { current: 12, total: 30 },
    checkpoints: [{ id: 'c1', label: '第一章', at: 10 }],
    createdAt: 'c',
  } as never)
  const [task] = store.view(DATE, DATE).tasks
  assert.equal(task!.checkpoints[0]!.reachedAt, pinned, 'half-done homework registered mid-way stamps what it passed')
})

await checkAsync('checkpoint identity is content: an unchanged line keeps its id and instant', async () => {
  const { store } = storeAt()
  await store.putTask({
    id: 't1', title: '作业', progress: { current: 12, total: 30 },
    checkpoints: [{ id: 'c1', label: '第一章', at: 10, reachedAt: '2026-09-10T08:00:00Z' }],
    createdAt: 'c',
  } as never)
  const patched = await store.patchTask('t1', {
    checkpoints: [{ label: '第一章', at: 10 }, { label: '第二章', at: 20 }],
  })
  assert.equal(patched.checkpoints[0]!.id, 'c1', 'content that still exists keeps its identity')
  assert.equal(patched.checkpoints[0]!.reachedAt, '2026-09-10T08:00:00Z', 'and its fact')
  assert.notEqual(patched.checkpoints[1]!.id, 'c1', 'a new line starts a new identity')
  assert.equal(patched.checkpoints[1]!.reachedAt, undefined)
})

await checkAsync('moving a checkpoint recomputes its reach along with its position', async () => {
  const { store } = storeAt()
  await store.putTask({
    id: 't1', title: '作业', progress: { current: 12, total: 30 },
    checkpoints: [{ id: 'c1', label: '第一章', at: 10, reachedAt: '2026-09-10T08:00:00Z' }],
    createdAt: 'c',
  } as never)
  const moved = await store.patchTask('t1', { checkpoints: [{ label: '第一章', at: 20 }] })
  assert.equal(moved.checkpoints[0]!.at, 20)
  assert.equal(moved.checkpoints[0]!.reachedAt, undefined, 'a moved line is a stage the progress has not met')
  assert.notEqual(moved.checkpoints[0]!.id, 'c1')
})

await checkAsync('checkpoints without a total are refused on both write paths', async () => {
  const { store } = storeAt()
  await assert.rejects(
    () => store.putTask({
      id: 't1', title: '作业', progress: { current: 0 },
      checkpoints: [{ id: 'c1', label: '第一章', at: 10 }], createdAt: 'c',
    } as never),
    /needs a progress total/,
    'a checkbox task has no axis to sit on',
  )
  await store.putTask({ id: 't2', title: '作业', progress: { current: 0, total: 30 }, createdAt: 'c' } as never)
  await assert.rejects(
    () => store.patchTask('t2', { checkpoints: [{ label: '第一章', at: 10 }], progress: { total: null } }),
    /needs a progress total/,
    'clearing the total out from under the stages is the same fault',
  )
})

// --- media -------------------------------------------------------------------

await checkAsync('finishing a media entry stamps an instant; un-finishing clears it', async () => {
  const { store } = storeAt()
  await store.putMedia({ id: 'm1', kind: 'book', title: '书', status: 'active', createdAt: 'c' } as never)
  const done = await store.patchMedia('m1', { status: 'done' })
  assert.equal(typeof done.finishedAt, 'string')
  const back = await store.patchMedia('m1', { status: 'active' })
  assert.equal(back.finishedAt, undefined, 'the instant follows the status')
})

await checkAsync('null clears a rating and a note', async () => {
  const { store } = storeAt()
  await store.putMedia({ id: 'm1', kind: 'film', title: '电影', status: 'done', rating: 5, notes: '好', createdAt: 'c' } as never)
  const cleared = await store.patchMedia('m1', { rating: null, notes: null })
  assert.equal(cleared.rating, undefined)
  assert.equal(cleared.notes, undefined)
  assert.equal(cleared.title, '电影', 'other fields are untouched')
})

await checkAsync('media is a hard delete', async () => {
  const { store } = storeAt()
  await store.putMedia({ id: 'm1', kind: 'film', title: '电影', status: 'done', createdAt: 'c' } as never)
  assert.equal(await store.deleteMedia('m1'), true)
  assert.equal(store.view(DATE, DATE).media.length, 0)
})

// --- the state view ----------------------------------------------------------

await checkAsync('the view reports both registries newest first', async () => {
  const { store } = storeAt()
  await store.putTask({ id: 'old', title: '旧', progress: { current: 0 }, createdAt: '2026-01-01T00:00:00Z' } as never)
  await store.putTask({ id: 'new', title: '新', progress: { current: 0 }, createdAt: '2026-02-01T00:00:00Z' } as never)
  assert.deepEqual(store.view(DATE, DATE).tasks.map(task => task.id), ['new', 'old'])
})

await checkAsync('the view derives task state and overdue from the day it is asked about', async () => {
  const { store } = storeAt()
  await store.putTask({ id: 't1', title: '作业', due: '2026-09-15', progress: { current: 0 }, createdAt: 'c' } as never)
  const onDate = store.view(DATE, DATE).tasks[0]!
  assert.equal(onDate.overdue, true, 'past its due date and unfinished')
  assert.equal(store.view(DATE, '2026-09-15').tasks[0]!.overdue, false, 'not yet overdue on its own day')
  await store.patchTask('t1', { progress: { current: 1 } })
  assert.equal(store.view(DATE, DATE).tasks[0]!.overdue, false, 'finishing clears overdue')
})

// --- 打卡: the cap and the record identity, inside the atomic write ----------

await checkAsync('two washing-up checks land, and a third is refused', async () => {
  const { store } = storeAt()
  await store.addCheck(DATE, 'wash', '2026-09-16T07:00:00Z')
  await store.addCheck(DATE, 'wash', '2026-09-16T22:00:00Z')
  await assert.rejects(() => store.addCheck(DATE, 'wash', '2026-09-16T23:00:00Z'), /至多两次/)
  assert.deepEqual(store.readDay(DATE)?.washes.times, ['2026-09-16T07:00:00Z', '2026-09-16T22:00:00Z'])
})

await checkAsync('the cap holds under concurrent check-ins', async () => {
  // Three writers, one day. Each one's count is the count the previous writer
  // committed, because the cap sits *inside* the read-modify-write. Lift it back
  // out (where the route used to keep it) and this records three washes.
  const { store } = storeAt()
  const settled = await Promise.allSettled([
    store.addCheck(DATE, 'wash', 'a'),
    store.addCheck(DATE, 'wash', 'b'),
    store.addCheck(DATE, 'wash', 'c'),
  ])
  assert.equal(store.readDay(DATE)?.washes.times.length, 2, 'never a third wash')
  const refused = settled.filter(result => result.status === 'rejected')
  assert.equal(refused.length, 1, 'exactly one writer is told the day is full')
  assert.equal((refused[0] as PromiseRejectedResult).reason.code, 'habit/check-limit')
})

await checkAsync('a day already holding three washes still reads, and cannot grow', async () => {
  // The race this cap closes could have left such a document behind. A stricter
  // schema would make it unreadable — which is why the cap is enforced on write
  // only, and why a deletion is the way back under it.
  const { store } = storeAt()
  await store.mutateDay(DATE, day => ({ ...day, washes: { times: ['a', 'b', 'c'] } }))
  assert.equal(store.readDay(DATE)?.washes.times.length, 3, 'the stored day is still readable')
  await assert.rejects(() => store.addCheck(DATE, 'wash', 'd'), /至多两次/)
  await store.removeCheck(DATE, 'wash', 0)
  assert.equal(store.readDay(DATE)?.washes.times.length, 2, 'one deletion brings it back under the cap')
})

await checkAsync('a shower is one record, not a list', async () => {
  const { store } = storeAt()
  await store.addCheck(DATE, 'shower', '2026-09-16T07:00:00Z')
  await assert.rejects(() => store.addCheck(DATE, 'shower', '2026-09-16T08:00:00Z'), /至多一次/)
  assert.equal(store.readDay(DATE)?.shower.at, '2026-09-16T07:00:00Z', 'the first instant stands')
  await store.removeCheck(DATE, 'shower')
  assert.equal(store.readDay(DATE)?.shower.at, null)
})

await checkAsync('retiming addresses a record that must exist', async () => {
  const { store } = storeAt()
  await store.addCheck(DATE, 'wash', '2026-09-16T07:00:00Z')
  await store.addCheck(DATE, 'wash', '2026-09-16T22:00:00Z')
  const latest = await store.retimeCheck(DATE, 'wash', '2026-09-16T21:00:00Z')
  assert.deepEqual(latest.washes.times[1], '2026-09-16T21:00:00Z', 'the most recent one, by default')
  const first = await store.retimeCheck(DATE, 'wash', '2026-09-16T06:00:00Z', 0)
  assert.deepEqual(first.washes.times, ['2026-09-16T06:00:00Z', '2026-09-16T21:00:00Z'])
  await assert.rejects(() => store.retimeCheck(DATE, 'wash', 'x', 5), /没有这条打卡/)
  await assert.rejects(() => store.retimeCheck(DATE, 'shower', 'x'), /洗澡尚未打卡/)
})

await checkAsync('removing a check that is already gone is a no-op, not a fault', async () => {
  const { store } = storeAt()
  await store.removeCheck(DATE, 'wash', 3)
  await store.removeCheck(DATE, 'shower')
  assert.equal(store.readDay(DATE)?.washes.times.length, 0)
})

report()
