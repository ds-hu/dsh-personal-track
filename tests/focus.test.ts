/**
 * Focus sessions and materials, against an in-memory domain.
 *
 * Two rules are load-bearing enough to be asserted directly rather than only
 * through the API:
 *
 * - a focus session that a crash left open is **dropped**, never closed at a
 *   guessed instant, and a duration is always `endedAt − startedAt`;
 * - an image's bytes live in `assets` and nowhere else, so deleting an entry
 *   has to take them with it and an interrupted delete has to leave something
 *   the sweep can find.
 *
 * Runs on Node's native type stripping:
 *   node tests/focus.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker, fixedClock, memoryDomain, testConfig } from './support.ts'
import { createHabitStore, type HabitStore } from '../src/host/store.ts'
import { focusSeconds } from '../src/host/derive.ts'
import type { HabitDomain } from '../src/host/domain.ts'

const checker = createChecker('focus sessions and materials')
const { check, checkAsync, report } = checker

/** One PNG's worth of base64, small enough to read in a failure message. */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** A store over a fresh in-memory domain, with its domain for inspection. */
function storeAt(at = '2026-09-16T12:00:00Z'): { store: HabitStore; domain: HabitDomain } {
  const domain = memoryDomain()
  return { store: createHabitStore(domain, testConfig({ now: fixedClock(at) })), domain }
}

/** A pending registry entry, as a test's subject. */
async function newTask(store: HabitStore, title = '线代作业'): Promise<string> {
  const id = store.newId()
  await store.putTask({
    id,
    title,
    progress: { current: 0 },
    checkpoints: [],
    materials: [],
    focusSessions: [],
    createdAt: '2026-09-16T11:00:00Z',
  })
  return id
}

// --- sessions ----------------------------------------------------------------

await checkAsync('a focus session records its start and stays open', async () => {
  const { store } = storeAt()
  const id = await newTask(store)
  const sessionId = await store.startFocus('task', id)
  const task = store.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(task?.focusSessions.length, 1, 'one session is open')
  assert.equal(task?.focusSessions[0]?.id, sessionId, 'and it is the one just opened')
  assert.equal(task?.focusSessions[0]?.startedAt, '2026-09-16T12:00:00.000Z', 'stamped by the store clock')
  assert.equal(task?.focusSessions[0]?.endedAt, undefined, 'no end yet')
  assert.equal(task?.focusSeconds, 0, 'an open session contributes no time')
})

await checkAsync('closing a session stamps the end, and the duration follows', async () => {
  const { store, domain } = storeAt()
  const id = await newTask(store)
  const sessionId = await store.startFocus('task', id)
  // Ten minutes later, through a store on the same domain.
  const later = createHabitStore(domain, testConfig({ now: fixedClock('2026-09-16T12:10:00Z') }))
  await later.endFocus('task', id, sessionId)
  const task = later.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(task?.focusSessions[0]?.endedAt, '2026-09-16T12:10:00.000Z')
  assert.equal(task?.focusSeconds, 600, 'ten minutes, derived from the two instants')
})

await checkAsync('only closed sessions count toward the total', async () => {
  const { store, domain } = storeAt()
  const id = await newTask(store)
  const first = await store.startFocus('task', id)
  const later = createHabitStore(domain, testConfig({ now: fixedClock('2026-09-16T12:05:00Z') }))
  await later.endFocus('task', id, first)
  await later.startFocus('task', id)
  const task = later.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(task?.focusSessions.length, 2, 'the second session is open beside the first')
  assert.equal(task?.focusSeconds, 300, 'only the closed one is summed')
  assert.equal(
    focusSeconds([{ startedAt: '2026-09-16T12:00:00Z', endedAt: '2026-09-16T11:00:00Z' }]), 0,
    'a backwards pair counts zero, never negative time',
  )
})

await checkAsync('starting a session drops one a crash left open', async () => {
  const { store, domain } = storeAt()
  const id = await newTask(store)
  await store.startFocus('task', id)
  // A second window opens focus on the same entry without the first ever
  // closing: the open session has no honest end, so it is discarded.
  const later = createHabitStore(domain, testConfig({ now: fixedClock('2026-09-16T13:00:00Z') }))
  const second = await later.startFocus('task', id)
  const task = later.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(task?.focusSessions.length, 1, 'the abandoned session is gone, not closed')
  assert.equal(task?.focusSessions[0]?.id, second)
  assert.equal(task?.focusSessions[0]?.startedAt, '2026-09-16T13:00:00.000Z')
})

await checkAsync('closing an unknown or already-closed session changes nothing', async () => {
  const { store } = storeAt()
  const id = await newTask(store)
  const sessionId = await store.startFocus('task', id)
  await store.endFocus('task', id, sessionId)
  await store.endFocus('task', id, sessionId)
  const first = store.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(first?.focusSessions[0]?.endedAt, '2026-09-16T12:00:00.000Z', 'the first stamp stands')
  await store.endFocus('task', id, 'nope')
  const second = store.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(second?.focusSessions.length, 1, 'an unknown id is a no-op, not a fault')
})

await checkAsync('an unknown entry is a missing key, which the transport maps to a 404', async () => {
  const { store } = storeAt()
  await assert.rejects(
    () => store.startFocus('task', 'nope'),
    (cause: unknown) => (cause as { code?: string }).code === 'missing-key',
  )
})

// --- materials: text ---------------------------------------------------------

await checkAsync('text blocks append in order and can be rewritten and removed', async () => {
  const { store } = storeAt()
  const id = await newTask(store)
  await store.addMaterialText('task', id, '## 第一块')
  await store.addMaterialText('task', id, '## 第二块')
  const two = store.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(two?.materials.length, 2)
  assert.deepEqual(two?.materials.map(material => material.kind), ['md', 'md'])
  const first = two?.materials[0]
  assert.ok(first !== undefined && first.kind === 'md')
  assert.equal(first.text, '## 第一块', 'the order is the order they were added in')

  await store.patchMaterialText('task', id, first.id, '改过')
  const patched = store.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(patched?.materials[0]?.kind === 'md' ? patched.materials[0].text : '', '改过')
  assert.equal(patched?.materials.length, 2, 'patching one block leaves the rest alone')

  await store.removeMaterial('task', id, first.id)
  const removed = store.view('2026-09-16', '2026-09-16').tasks[0]
  assert.equal(removed?.materials.length, 1)
  assert.equal(removed?.materials[0]?.kind === 'md' ? removed.materials[0].text : '', '## 第二块')
})

// --- materials: images -------------------------------------------------------

await checkAsync('an image is stored once and read back with its derived facts', async () => {
  const { store, domain } = storeAt()
  const id = await newTask(store)
  await store.addMaterialImage('task', id, { mime: 'image/png', data: TINY_PNG, name: '讲义.png' })
  const task = store.view('2026-09-16', '2026-09-16').tasks[0]
  const material = task?.materials[0]
  assert.ok(material !== undefined && material.kind === 'image')
  assert.equal(material.name, '讲义.png')
  assert.equal(material.mime, 'image/png', 'mime is derived from the asset')
  assert.equal(
    material.bytes,
    Buffer.from(TINY_PNG, 'base64').length,
    'and so is the byte size — neither is stored on the material',
  )
  const asset = store.readAsset(material.assetId)
  assert.equal(asset?.data, TINY_PNG, 'the bytes live in the assets table')
  assert.equal(domain.table('assets').size, 1, 'exactly one asset document was written')
})

await checkAsync('removing an image material takes its asset with it', async () => {
  const { store, domain } = storeAt()
  const id = await newTask(store)
  await store.addMaterialImage('task', id, { mime: 'image/png', data: TINY_PNG })
  const material = store.view('2026-09-16', '2026-09-16').tasks[0]?.materials[0]
  assert.ok(material !== undefined && material.kind === 'image')
  await store.removeMaterial('task', id, material.id)
  assert.equal(store.readAsset(material.assetId), undefined, 'the bytes go with the reference')
  assert.equal(domain.table('assets').size, 0)
  assert.equal(store.view('2026-09-16', '2026-09-16').tasks[0]?.materials.length, 0)
})

await checkAsync('deleting an entry cascades to its images', async () => {
  const { store, domain } = storeAt()
  const taskId = await newTask(store)
  await store.addMaterialImage('task', taskId, { mime: 'image/png', data: TINY_PNG })
  const mediaId = 'media-1'
  await store.putMedia({
    id: mediaId,
    kind: 'book',
    title: '三体',
    status: 'active',
    materials: [],
    focusSessions: [],
    createdAt: '2026-09-16T11:00:00Z',
  })
  await store.addMaterialImage('media', mediaId, { mime: 'image/jpeg', data: TINY_PNG })
  assert.equal(domain.table('assets').size, 2)

  await store.deleteTask(taskId)
  assert.equal(domain.table('assets').size, 1, 'the task took its own image and only its own')
  await store.deleteMedia(mediaId)
  assert.equal(domain.table('assets').size, 0, 'and the media entry took the other')
})

await checkAsync('the sweep reclaims orphans and leaves referenced images alone', async () => {
  const { store, domain } = storeAt()
  const id = await newTask(store)
  await store.addMaterialImage('task', id, { mime: 'image/png', data: TINY_PNG })
  // An orphan is what an interrupted delete leaves behind: bytes with no
  // material pointing at them.
  await domain.table('assets').put('orphan', {
    id: 'orphan',
    mime: 'image/png',
    data: TINY_PNG,
    createdAt: '2026-09-16T11:30:00Z',
  })
  assert.equal(await store.sweepOrphanAssets(), 1, 'only the unreferenced image goes')
  assert.equal(domain.table('assets').size, 1, 'the referenced one stays')
  assert.equal(await store.sweepOrphanAssets(), 0, 'and a second sweep finds nothing to do')
})

await checkAsync('a task with no materials reads with an empty list, not undefined', async () => {
  const { store } = storeAt()
  const id = await newTask(store)
  const task = store.view('2026-09-16', '2026-09-16').tasks.find(entry => entry.id === id)
  assert.deepEqual(task?.materials, [])
  assert.deepEqual(task?.focusSessions, [])
  assert.equal(task?.focusSeconds, 0)
})

report()
