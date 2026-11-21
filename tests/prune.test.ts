/**
 * The image prune: which images "delete images on completed entries" takes.
 *
 * The rule is the whole feature, and it spans three registries whose "finished"
 * means three different things — a task's state is derived from its progress
 * axis, a film's is a status someone chose, a todo's `done` is its own fact.
 * A test at the HTTP layer would prove the route answers; this one proves the
 * rule, and the promise the card shows before it asks.
 *
 * Runs on Node's native type stripping:
 *   node tests/prune.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker, fixedClock, memoryDomain, testConfig } from './support.ts'
import { createHabitStore, type HabitStore } from '../src/host/store.ts'

const checker = createChecker('the image prune')
const { checkAsync, report } = checker

const DATE = '2026-09-16'

/** Real base64, of the sizes this file asserts: 1, 2 and 3 bytes. */
const ONE_BYTE = 'AA=='
const TWO_BYTES = 'AAA='
const THREE_BYTES = 'AAAA'

/** A store over a fresh in-memory domain. */
function storeAt(): HabitStore {
  return createHabitStore(memoryDomain(), testConfig({ now: fixedClock('2026-09-16T12:00:00Z') }))
}

/** Every registry entry's materials, as the board would see them. */
function materialsOf(store: HabitStore): Map<string, readonly { kind: string }[]> {
  const view = store.view(DATE, DATE)
  return new Map([
    ...view.tasks.map(entry => [entry.id, entry.materials] as const),
    ...view.media.map(entry => [entry.id, entry.materials] as const),
    ...view.todos.map(entry => [entry.id, entry.materials] as const),
  ])
}

await checkAsync('only images on finished entries go, and the preview is the promise', async () => {
  const store = storeAt()
  await store.putTask({ id: 'done', title: '做完的', progress: { current: 2, total: 2 }, createdAt: 'c' } as never)
  await store.putTask({ id: 'open', title: '没做完的', progress: { current: 1, total: 2 }, createdAt: 'c' } as never)
  await store.putTodo({ id: 'ticked', title: '勾掉的', done: true, createdAt: 'c' } as never)
  await store.putTodo({ id: 'togo', title: '没勾的', done: false, createdAt: 'c' } as never)
  await store.putMedia({ id: 'watched', kind: 'film', title: '看完的', status: 'done', createdAt: 'c' } as never)
  await store.putMedia({ id: 'dropped', kind: 'film', title: '弃掉的', status: 'dropped', createdAt: 'c' } as never)

  await store.addMaterialImage('task', 'done', { mime: 'image/png', data: THREE_BYTES })
  await store.addMaterialImage('task', 'open', { mime: 'image/png', data: THREE_BYTES })
  await store.addMaterialImage('todo', 'ticked', { mime: 'image/png', data: TWO_BYTES })
  await store.addMaterialImage('todo', 'togo', { mime: 'image/png', data: TWO_BYTES })
  await store.addMaterialImage('media', 'watched', { mime: 'image/png', data: ONE_BYTE })
  await store.addMaterialImage('media', 'dropped', { mime: 'image/png', data: ONE_BYTE })

  const preview = store.completedImageUsage()
  assert.deepEqual(preview, { count: 3, bytes: 6 },
    'a done task, a ticked todo and a watched film — not the dropped one')
  assert.equal(preview.bytes, 3 + 2 + 1, 'bytes are the decoded sizes, summed per image')

  const result = await store.pruneCompletedImages()
  assert.deepEqual(result, { entries: 3, images: preview.count, bytes: preview.bytes },
    'the number the card showed is what the prune took')
  assert.deepEqual(store.completedImageUsage(), { count: 0, bytes: 0 }, 'and nothing is left to offer')
  assert.deepEqual(await store.pruneCompletedImages(), { entries: 0, images: 0, bytes: 0 },
    'a second run is a no-op, not an error')

  const left = materialsOf(store)
  assert.equal(left.get('done')?.length, 0, 'the finished task lost its image')
  assert.equal(left.get('open')?.length, 1, 'an unfinished task keeps its own')
  assert.equal(left.get('ticked')?.length, 0, 'the ticked todo lost its image')
  assert.equal(left.get('togo')?.length, 1, 'an open todo keeps its own')
  assert.equal(left.get('watched')?.length, 0, 'the watched film lost its image')
  // A dropped film was never finished with, so nothing about it is "completed
  // work whose evidence is expendable" — the entry itself is the way to drop it.
  assert.equal(left.get('dropped')?.length, 1, 'a dropped film keeps its image')
})

await checkAsync('a finished entry keeps its outline: only the images go', async () => {
  const store = storeAt()
  await store.putTask({ id: 't', title: '作业', progress: { current: 1, total: 1 }, createdAt: 'c' } as never)
  await store.addMaterialText('task', 't', '## 要点')
  await store.addMaterialImage('task', 't', { mime: 'image/png', data: THREE_BYTES })

  assert.equal((await store.pruneCompletedImages()).images, 1)
  const materials = materialsOf(store).get('t') ?? []
  assert.deepEqual(materials.map(material => material.kind), ['md'],
    'the markdown block is the outline of what was done; the screenshot is the bulk')
})

await checkAsync('the bytes leave with the reference, so the sweep has nothing to find', async () => {
  const store = storeAt()
  await store.putTask({ id: 't', title: '作业', progress: { current: 1, total: 1 }, createdAt: 'c' } as never)
  await store.addMaterialImage('task', 't', { mime: 'image/png', data: THREE_BYTES })
  const assetId = (materialsOf(store).get('t') ?? [])
    .map(material => (material as { assetId?: string }).assetId)
    .find(id => id !== undefined)
  assert.ok(assetId !== undefined, 'the image material carries the id of its bytes')
  assert.ok(store.readAsset(assetId) !== undefined, 'and the bytes are there to begin with')

  await store.pruneCompletedImages()
  assert.equal(store.readAsset(assetId), undefined, 'the prune takes the bytes, not just the pointer')
  assert.equal(await store.sweepOrphanAssets(), 0, 'nothing was orphaned: the asset is gone, not unreferenced')
})

await checkAsync('completion is derived, so finishing a task later makes its images prunable', async () => {
  const store = storeAt()
  await store.putTask({ id: 't', title: '作业', progress: { current: 1, total: 2 }, createdAt: 'c' } as never)
  await store.addMaterialImage('task', 't', { mime: 'image/png', data: THREE_BYTES })

  // No stored "completed" flag exists to fall out of step with the progress
  // axis, so the offer follows the fact: nothing while it is in progress…
  assert.equal(store.completedImageUsage().count, 0, 'a task in progress offers nothing')
  assert.equal((await store.pruneCompletedImages()).images, 0)

  await store.patchTask('t', { progress: { current: 2 } })
  assert.equal(store.completedImageUsage().count, 1, 'filled progress makes the entry finished')
  assert.equal((await store.pruneCompletedImages()).images, 1)
})

report()
