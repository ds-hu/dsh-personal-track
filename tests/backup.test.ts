/**
 * Backup: the file is a fact carrier, and an import is all-or-nothing.
 *
 * `docs/adr/0002-derived-state-not-stored.md` reaches its sharpest form here —
 * the file must not be able to contradict the data it came from, which means no
 * cell count, ratio, streak or overdue flag may appear in it. Writing that as a
 * whitelist over the exported keys is the only way to state the rule as an
 * invariant rather than as a list of things we remembered to omit.
 *
 * Runs on Node's native type stripping:
 *   node tests/backup.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker, createHarness, type Harness } from './support.ts'
import { BACKUP_FORMAT, BACKUP_VERSION, BackupFormatError, readBackup } from '../src/host/backup.ts'

const checker = createChecker('backup: facts out, facts in')
const { check, checkAsync, report } = checker

const DATE = '2026-09-16'
const NEXT = '2026-09-17'

/** Keys a stored habit day may carry. Anything else is a derived value leaked. */
const DAY_FACT_KEYS = [
  'date', 'washes', 'shower', 'meals', 'vocab', 'duolingo', 'run',
  'rope', 'pullup', 'plank', 'equipment', 'washing',
]

/** Fill one day with a bit of everything, so an export has something to carry. */
async function populate(api: Harness): Promise<void> {
  await api.store.setVocabTarget(DATE, { new: 10, review: 5 })
  await api.store.mutateDay(DATE, day => ({
    ...day,
    washes: { times: ['2026-09-16T07:00:00'] },
    shower: { at: '2026-09-16T07:30:00' },
    meals: { lunch: { at: '2026-09-16T12:00:00', price: 12.5 } },
  }))
  await api.store.addSession(DATE, 'vocab', { at: '2026-09-16T08:00:00', new: 10, review: 5, minutes: 30 })
  await api.store.addSession(DATE, 'duolingo', { at: '2026-09-16T09:00:00', minutes: 12 })
  await api.store.addSession(DATE, 'washing', { at: '2026-09-16T20:00:00', pieces: 3 })
  await api.store.setStock(2, '2026-09-16T20:00:00')
  await api.store.putTask({
    id: 't1', title: '作业', category: '数学', due: NEXT, progress: { current: 1 }, completedAt: '2026-09-16T10:00:00', createdAt: 'c',
  } as never)
  await api.store.putMedia({ id: 'm1', kind: 'book', title: '书', status: 'done', rating: 5, createdAt: 'c' } as never)
}

// --- the file's shape --------------------------------------------------------

await checkAsync('the bundle carries identity, a version and the five fact tables', async () => {
  const api = createHarness()
  await populate(api)
  const bundle = api.backup.exportAll('2026-09-16T21:00:00Z')
  assert.deepEqual(
    Object.keys(bundle).sort(),
    ['assets', 'counters', 'days', 'exportedAt', 'format', 'media', 'tasks', 'version'],
    'no sixth table, and nothing derived alongside them',
  )
  assert.equal(bundle.format, BACKUP_FORMAT)
  assert.equal(bundle.version, BACKUP_VERSION)
  assert.equal(bundle.exportedAt, '2026-09-16T21:00:00Z')
})

await checkAsync('a stored day exports only its fact keys', async () => {
  const api = createHarness()
  await populate(api)
  const [day] = api.backup.exportAll('x').days
  assert.ok(day)
  assert.deepEqual(Object.keys(day).sort(), [...DAY_FACT_KEYS].sort())
  for (const derived of ['cells', 'progress', 'perfect', 'isToday', 'target']) {
    assert.equal(derived in day, false, `${derived} is derived and must not be in the file`)
  }
})

await checkAsync('a task exports its record without the states the view derives', async () => {
  const api = createHarness()
  await populate(api)
  const [task] = api.backup.exportAll('x').tasks
  assert.ok(task)
  assert.deepEqual(
    Object.keys(task).sort(),
    ['category', 'checkpoints', 'completedAt', 'createdAt', 'due', 'focusSessions', 'id', 'materials', 'progress', 'title'].sort(),
  )
  assert.equal('state' in task, false, '待办/进行中/完成 is derived')
  assert.equal('overdue' in task, false, '逾期 is derived')
  assert.equal('focusSeconds' in task, false, 'focus time is derived from the sessions')
})

await checkAsync('a vocab session exports no weighted ratio', async () => {
  const api = createHarness()
  await populate(api)
  const [day] = api.backup.exportAll('x').days
  assert.ok(day?.vocab)
  assert.deepEqual(Object.keys(day.vocab).sort(), ['sessions', 'target'])
  assert.equal('ratio' in day.vocab, false)
  const [session] = day.vocab.sessions
  assert.deepEqual(Object.keys(session!).sort(), ['at', 'id', 'minutes', 'new', 'review'])
})

// --- ordering ----------------------------------------------------------------

await checkAsync('days ascend by date; registries are newest first', async () => {
  const api = createHarness()
  await api.store.mutateDay(NEXT, day => ({ ...day, shower: { at: 'x' } }))
  await api.store.mutateDay(DATE, day => ({ ...day, shower: { at: 'x' } }))
  await api.store.putMedia({ id: 'old', kind: 'film', title: '旧', status: 'active', createdAt: '2026-01-01T00:00:00Z' } as never)
  await api.store.putMedia({ id: 'new', kind: 'film', title: '新', status: 'active', createdAt: '2026-02-01T00:00:00Z' } as never)

  const bundle = api.backup.exportAll('x')
  assert.deepEqual(bundle.days.map(day => day.date), [DATE, NEXT])
  assert.deepEqual(bundle.media.map(entry => entry.id), ['new', 'old'])
})

// --- reading a candidate file ------------------------------------------------

/** The BackupFormatError a call raises, or a failure explaining that it did not. */
function formatErrorFrom(value: unknown): BackupFormatError {
  try {
    readBackup(value)
  } catch (cause) {
    if (cause instanceof BackupFormatError) return cause
    throw cause
  }
  throw new Error(`expected a BackupFormatError for ${JSON.stringify(value)}`)
}

check('a file that is not ours is refused by identity, not by field path', () => {
  for (const [value, expected] of [
    [null, '这不是本插件的备份文件'],
    ['a string', '这不是本插件的备份文件'],
    [{ hello: 'world' }, '这不是本插件的备份文件（缺少 format 标记）'],
  ] as const) {
    assert.equal(formatErrorFrom(value).message, expected, `for ${JSON.stringify(value)}`)
  }
})

check('a newer layout version is named rather than reported as a bad field', () => {
  const error = formatErrorFrom({ format: BACKUP_FORMAT, version: 99 })
  assert.match(error.message, /版本 99/)
  assert.match(error.message, /当前支持 1/)
})

check('an invalid field inside a well-formed envelope names that field', () => {
  const error = formatErrorFrom({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: 'x',
    days: [{ date: DATE, washes: { times: 'nope' } }], counters: {}, media: [], tasks: [],
  })
  assert.match(error.message, /days\.0/)
})

// --- all-or-nothing ----------------------------------------------------------

await checkAsync('a corrupt bundle is refused whole and writes nothing', async () => {
  const api = createHarness()
  await populate(api)
  const good = api.backup.exportAll('x')
  const before = JSON.stringify(api.backup.exportAll('x'))

  const corrupt = { ...good, days: [...good.days, { date: '2026-09-18', washes: { times: 'nope' } }] }
  await assert.rejects(
    () => api.import('merge', corrupt),
    (cause: unknown) => cause instanceof BackupFormatError,
  )
  assert.equal(JSON.stringify(api.backup.exportAll('x')), before, 'nothing landed, not even the valid records')
})

await checkAsync('a refused import does not prune, even in replace mode', async () => {
  const api = createHarness()
  await populate(api)
  const before = JSON.stringify(api.backup.exportAll('x'))
  await assert.rejects(() => api.import('replace', { hello: 'world' }))
  assert.equal(JSON.stringify(api.backup.exportAll('x')), before)
})

await checkAsync('a task whose checkpoints have no axis to sit on is refused', async () => {
  const api = createHarness()
  await populate(api)
  const before = JSON.stringify(api.backup.exportAll('x'))
  // Schema-valid on its own (a total is optional); the fault is cross-field,
  // so it is the import's own rule that must catch it.
  const stray = {
    ...api.backup.exportAll('x'),
    tasks: [{
      id: 't9', title: '无轴作业', progress: { current: 0 },
      checkpoints: [{ id: 'c1', label: '第一章', at: 10 }], createdAt: 'c',
    }],
  }
  await assert.rejects(
    () => api.import('merge', stray),
    (cause: unknown) => cause instanceof BackupFormatError && /检查点缺少目标量/.test(cause.message),
  )
  assert.equal(JSON.stringify(api.backup.exportAll('x')), before, 'nothing landed')
})

// --- merge vs replace --------------------------------------------------------

/** A bundle carrying one day, one task and one counter value. */
function smallBundle(): Record<string, unknown> {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: '2026-09-16T21:00:00Z',
    days: [{ date: DATE, washes: { times: ['a', 'b'] } }],
    counters: { laundry: { pending: 7, updatedAt: 'x' } },
    media: [],
    tasks: [],
  }
}

await checkAsync('merge overwrites the keys the file carries and keeps the rest', async () => {
  const api = createHarness()
  await populate(api)
  const report0 = await api.backup.importAll(smallBundle(), 'merge')
  assert.deepEqual(report0, { mode: 'merge', days: 1, media: 0, tasks: 0, counters: 1, assets: 0, removed: 0 })

  const after = api.backup.exportAll('x')
  assert.equal(after.counters.laundry!.pending, 7, 'the counter was overwritten')
  assert.equal(after.days.find(day => day.date === DATE)!.washes.times.length, 2, 'the day was overwritten')
  // The task and the media entry the file omits are still there.
  assert.equal(after.tasks.length, 1, 'merge deletes nothing')
  assert.equal(after.media.length, 1, 'merge deletes nothing')
})

await checkAsync('replace also drops every record the file omits, and counts them', async () => {
  const api = createHarness()
  await populate(api)
  const report0 = await api.backup.importAll(smallBundle(), 'replace')
  assert.equal(report0.removed, 2, 'the task and the media entry went')

  const after = api.backup.exportAll('x')
  assert.deepEqual(after.days.map(day => day.date), [DATE], 'the day the file omits is gone')
  assert.deepEqual(after.tasks, [])
  assert.deepEqual(after.media, [])
})

await checkAsync('replace keeps a counter the file omits out of the result, and reads zero', async () => {
  const api = createHarness()
  await populate(api)
  const withoutCounters = { ...smallBundle(), counters: {} }
  const report0 = await api.backup.importAll(withoutCounters, 'replace')
  // The populated domain held a day, a task, a media entry and a counter; the
  // file carries only the day.
  assert.equal(report0.removed, 3, 'task, media entry and counter all went')
  assert.equal(api.store.view(DATE, DATE).stock.pending, 0, 'and the counter reads as unset')
})

// --- the round trip ----------------------------------------------------------

await checkAsync('an export re-imported into an empty domain reproduces the same facts', async () => {
  const source = createHarness()
  await populate(source)
  const bundle = source.backup.exportAll('x')

  const restored = createHarness()
  await restored.backup.importAll(bundle, 'replace')
  assert.deepEqual(restored.backup.exportAll('x'), bundle, 'the file is a fixed point of the round trip')
})

await checkAsync('every derived value is recomputed from the imported records', async () => {
  const source = createHarness()
  await populate(source)
  const bundle = source.backup.exportAll('x')

  const restored = createHarness()
  await restored.backup.importAll(bundle, 'replace')
  const before = source.store.view(DATE, DATE)
  const after = restored.store.view(DATE, DATE)
  assert.deepEqual(after.day.progress, before.day.progress, 'the completion bar is rebuilt')
  assert.deepEqual(after.day.vocab, before.day.vocab, 'so is the weighted vocabulary progress')
  assert.deepEqual(after.tasks.map(task => [task.id, task.state, task.overdue]),
    before.tasks.map(task => [task.id, task.state, task.overdue]), 'and the derived task states')
  assert.deepEqual(after.stock, before.stock)
})

await checkAsync('an imported target snapshot is honoured rather than inherited', async () => {
  const source = createHarness()
  await populate(source)
  const bundle = source.backup.exportAll('x')

  const restored = createHarness()
  await restored.backup.importAll(bundle, 'replace')
  assert.deepEqual(restored.store.resolveTarget(DATE), { new: 10, review: 5 }, 'the snapshot travelled')
  assert.deepEqual(restored.store.resolveTarget(NEXT), { new: 10, review: 5 }, 'and carries forward')
})

report()
