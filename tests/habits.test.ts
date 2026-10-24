/**
 * The habit inventory (`src/host/habits.ts`) — the one statement of which
 * habits exist.
 *
 * What this file guards is not the inventory's contents but its *singleness*:
 * that the completion bar, the statistics heat grid, the "达标" rule and the
 * wire enums are all reading the same rows. Every assertion below fails if a
 * second copy of the inventory comes back.
 *
 * Runs on Node's native type stripping, like the rest of the suite:
 *   node tests/habits.test.ts
 */
import { strict as assert } from 'node:assert'
import {
  CELL_IDS,
  CELL_TOTAL,
  CHECK_HABITS,
  HABITS,
  MEAL_SLOTS,
  habitMet,
  habitOf,
  type CellId,
} from '../src/host/habits.ts'
import { dayCells } from '../src/host/derive.ts'
import { dayRecord } from '../src/host/domain.ts'

let passed = 0

/** Run one labelled case. */
function check(label: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

/** Every cell id, as the bar reports them for a day. */
const barIds = (cells: readonly { readonly id: string }[]): string[] => cells.map(cell => cell.id)

console.log('the inventory')
check('seven habits own the eight cells of the bar', () => {
  assert.equal(HABITS.length, 7)
  assert.equal(CELL_TOTAL, 8)
  assert.equal(CELL_IDS.length, CELL_TOTAL)
  assert.equal(new Set(CELL_IDS).size, CELL_TOTAL, 'a cell belongs to exactly one habit')
  assert.equal(new Set(HABITS.map(habit => habit.id)).size, HABITS.length, 'habit ids are unique')
})
check('洗漱 owns two cells and stays one habit', () => {
  const wash = habitOf('wash')
  assert.deepEqual(wash.cells.map(cell => cell.id), ['wash1', 'wash2'])
  assert.equal(habitOf('shower').cells.length, 1)
})
check('every habit is addressable by its own id, and carries a label', () => {
  for (const habit of HABITS) {
    assert.equal(habitOf(habit.id), habit)
    assert.notEqual(habit.label.trim(), '', `${habit.id} needs a display name`)
    for (const cell of habit.cells) assert.notEqual(cell.label.trim(), '', `${cell.id} needs a label`)
  }
})
check('a 打卡 habit states its daily cap, and no other form carries one', () => {
  for (const habit of HABITS) {
    if (habit.form === 'check') assert.ok((habit.maxPerDay ?? 0) >= 1, `${habit.id} needs a cap`)
    else assert.equal(habit.maxPerDay, undefined, `${habit.id} is not a 打卡 habit`)
  }
  assert.equal(habitOf('wash').maxPerDay, 2)
  assert.equal(habitOf('shower').maxPerDay, 1)
})

console.log('the bar reads the inventory')
check('the bar lists exactly the inventory cells, in inventory order', () => {
  const cells = dayCells(undefined)
  assert.deepEqual(barIds(cells), [...CELL_IDS])
  const labels = HABITS.flatMap(habit => habit.cells.map(cell => cell.label))
  assert.deepEqual(cells.map(cell => cell.label), labels, 'labels come from the inventory, not a second table')
})
check('a perfect day fills every cell', () => {
  const day = dayRecord.parse({
    date: '2026-09-16',
    washes: { times: ['a', 'b'] },
    shower: { at: 'x' },
    meals: { breakfast: { at: 'x' }, lunch: { at: 'x' }, dinner: { at: 'x' } },
    vocab: { target: { new: 1, review: 0 }, sessions: [{ id: 'v1', at: 'x', new: 1, review: 0, minutes: 5 }] },
    duolingo: [{ id: 'd1', at: 'x', minutes: 10 }],
  })
  const cells = dayCells(day)
  assert.deepEqual(cells.map(cell => cell.value), [1, 1, 1, 1, 1, 1, 1, 1])
})

console.log('达标 is derived from the cells, never restated')
check('a habit is met exactly when every cell it owns is full', () => {
  for (const habit of HABITS) {
    assert.equal(habitMet(habit, () => 1), true, `${habit.id} is met when its cells are full`)
    for (const cell of habit.cells) {
      // The broken state: one owned cell short. A second definition of "met"
      // (the old `stats.ts` predicate list) could disagree with this; this one
      // cannot, because it has nothing else to read.
      assert.equal(
        habitMet(habit, (id: CellId) => (id === cell.id ? 0 : 1)),
        false,
        `${habit.id} cannot be met while ${cell.id} is short`,
      )
    }
  }
})
check('the bar and the predicate agree on a real day', () => {
  const oneWash = dayRecord.parse({ date: '2026-09-16', washes: { times: ['a'] } })
  const values = new Map(dayCells(oneWash).map(cell => [cell.id, cell.value]))
  const valueOf = (id: CellId): number => values.get(id) ?? 0
  assert.equal(valueOf('wash1'), 1, 'one wash fills the first cell')
  assert.equal(valueOf('wash2'), 0, 'and leaves the second empty')
  assert.equal(habitMet(habitOf('wash'), valueOf), false, 'so 洗漱 is not met')
  assert.equal(habitMet(habitOf('shower'), valueOf), false, 'and neither is 洗澡')
})

console.log('the wire enums are the inventory, not a second list')
check('the 打卡 enum is exactly the check habits', () => {
  const fromInventory = HABITS.filter(habit => habit.form === 'check').map(habit => habit.id)
  assert.deepEqual([...CHECK_HABITS], fromInventory, 'a new 打卡 habit must be added to CHECK_HABITS too')
})
check('the meal-slot enum is exactly the slot habits', () => {
  const fromInventory = HABITS.filter(habit => habit.form === 'slot').map(habit => habit.id)
  assert.deepEqual([...MEAL_SLOTS], fromInventory, 'a new 槽位 habit must be added to MEAL_SLOTS too')
})

console.log(`\n${passed} checks passed`)
