/**
 * Materials staged inside the create/edit form.
 *
 * The form cannot write as it goes — a task being created has no id yet — so it
 * collects items and submits a *plan*. These cases assert that plan: what is
 * skipped because nothing changed, what order the writes go in, and that landing
 * them issues exactly the calls it promised.
 *
 * Runs on Node's native type stripping: `node tests/materials-form.test.ts`
 */
import { strict as assert } from 'node:assert'
import {
  applyMaterialWrites,
  newImageItem,
  newTextBlock,
  planMaterialWrites,
  stagedFrom,
  tallyOf,
  type MaterialOp,
  type StagedMaterial,
} from '../src/client/board/materials-form.ts'
import type { EntryAnswer, HabitClient } from '../src/client/api.ts'
import type { Material } from '../src/client/types.ts'

let passed = 0

/** Run one labelled case. */
function check(label: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

/** Run one asynchronous case. */
async function checkAsync(label: string, fn: () => Promise<void>): Promise<void> {
  await fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

/** One response shape stand-in; these cases assert calls, not payloads. */
const answer = (): EntryAnswer => ({}) as EntryAnswer

/** A stored image, as an entry's material list carries it. */
const storedImage: Material = {
  kind: 'image',
  id: 'mat-image',
  assetId: 'asset-1',
  name: '板书.png',
  mime: 'image/png',
  bytes: 2048,
  createdAt: '2026-11-01T00:00:00.000Z',
}

/** A stored Markdown block. */
const storedBlock: Material = { kind: 'md', id: 'mat-text', text: '# 一开始的内容' }

/** The op names of a plan, for readable assertions. */
const ops = (plan: readonly MaterialOp[]): readonly string[] => plan.map(op => op.op)

console.log('materials staged in a form (what a submit will write)')

check('an entry opens as items that write nothing on their own', () => {
  const items = stagedFrom([storedBlock, storedImage])
  assert.deepEqual(ops(planMaterialWrites(items)), [], 'an untouched form is not a write')
  assert.equal(items.length, 2)
})

check('a new picture and a new block are added, in the order they were staged', () => {
  const items: StagedMaterial[] = [
    newImageItem({ mime: 'image/png', data: 'AAAA', name: '截图.png' }, 3),
    newTextBlock(),
  ]
  const plan = planMaterialWrites(items)
  assert.deepEqual(ops(plan), ['addImage', 'addText'])
  assert.deepEqual(
    plan[0]?.op === 'addImage' ? plan[0].image : undefined,
    { mime: 'image/png', data: 'AAAA', name: '截图.png' },
    'the bytes read at pick time travel as they are',
  )
  assert.equal(plan[1]?.op === 'addText' ? plan[1].text : 'x', '', 'an empty block is still a block')
})

check('editing a stored block rewrites it; leaving it alone does not', () => {
  const items = stagedFrom([storedBlock])
  const edited: StagedMaterial[] = items.map(item => (
    item.kind === 'md' ? { ...item, text: '# 改过' } : item
  ))
  const plan = planMaterialWrites(edited)
  assert.deepEqual(ops(plan), ['patchText'])
  assert.equal(plan[0]?.op === 'patchText' ? plan[0].materialId : '', 'mat-text')
  assert.equal(plan[0]?.op === 'patchText' ? plan[0].text : '', '# 改过')
})

check('a stored image is never re-uploaded', () => {
  const items = stagedFrom([storedImage, storedImage])
  assert.deepEqual(ops(planMaterialWrites(items)), [])
})

check('removals come first, then additions, then rewrites', () => {
  const items = stagedFrom([storedBlock])
  const edited: StagedMaterial[] = [
    ...items.map(item => (item.kind === 'md' ? { ...item, text: '改' } : item)),
    newImageItem({ mime: 'image/jpeg', data: 'BBBB', name: 'b.jpg' }, 3),
  ]
  const plan = planMaterialWrites(edited, ['mat-gone'])
  assert.deepEqual(ops(plan), ['remove', 'addImage', 'patchText'])
})

check('the tally counts blocks, pictures and their bytes', () => {
  const items: StagedMaterial[] = [
    ...stagedFrom([storedBlock, storedImage]),
    newImageItem({ mime: 'image/png', data: 'AAAA', name: 'c.png' }, 1024),
  ]
  assert.deepEqual(tallyOf(items), { texts: 1, images: 2, bytes: 2048 + 1024 })
})

await checkAsync('landing a plan issues one call per write, in order, and answers the last', async () => {
  const calls: string[] = []
  const client: Pick<HabitClient, 'addImageMaterial' | 'addTextMaterial' | 'patchTextMaterial' | 'removeMaterial'> = {
    addImageMaterial: async (_owner, id, image) => {
      calls.push(`image ${id} ${image.name}`)
      return answer()
    },
    addTextMaterial: async (_owner, id, text) => {
      calls.push(`text ${id} ${text.length}`)
      return answer()
    },
    patchTextMaterial: async (_owner, id, materialId, text) => {
      calls.push(`patch ${id} ${materialId} ${text.length}`)
      return answer()
    },
    removeMaterial: async (_owner, id, materialId) => {
      calls.push(`remove ${id} ${materialId}`)
      return answer() as never
    },
  }

  const plan = planMaterialWrites(
    [
      ...stagedFrom([{ kind: 'md', id: 'mat-text', text: '旧' }])
        .map(item => (item.kind === 'md' ? { ...item, text: '新的' } : item)),
      newImageItem({ mime: 'image/png', data: 'AAAA', name: 'd.png' }, 3),
    ],
    ['mat-gone'],
  )
  const last = await applyMaterialWrites(plan, 'task', 'task-1', client, { date: '2026-11-09' })

  assert.deepEqual(calls, [
    'remove task-1 mat-gone',
    'image task-1 d.png',
    'patch task-1 mat-text 2',
  ], 'sequentially, in plan order')
  assert.ok(last !== undefined, 'the caller adopts the last answer')
})

await checkAsync('an empty plan calls nothing and answers nothing', async () => {
  const calls: string[] = []
  const client = {
    addImageMaterial: async () => { calls.push('image'); return answer() },
    addTextMaterial: async () => { calls.push('text'); return answer() },
    patchTextMaterial: async () => { calls.push('patch'); return answer() },
    removeMaterial: async () => { calls.push('remove'); return answer() as never },
  }
  const last = await applyMaterialWrites([], 'task', 'task-1', client)
  assert.deepEqual(calls, [])
  assert.equal(last, undefined)
})

console.log(`\n${passed} passed`)
process.exitCode = 0
