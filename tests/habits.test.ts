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
check('eight habits own the nine cells of the bar', () => {
  assert.equal(HABITS.length, 8)
  assert.equal(CELL_TOTAL, 9)
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
    plank: [{ id: 'p1', at: 'x', seconds: 60 }],
  })
  const cells = dayCells(day)
  assert.deepEqual(cells.map(cell => cell.value), [1, 1, 1, 1, 1, 1, 1, 1, 1])
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

console.log('健身 is one presence cell, filled by any training')
/** The 健身 cell's fraction for a day built from `patch`. */
const sportOf = (patch: Record<string, unknown>): number => {
  const day = dayRecord.parse({ date: '2026-09-16', ...patch })
  const cell = dayCells(day).find(candidate => candidate.id === 'sport')
  assert.ok(cell !== undefined, 'the bar must carry a 健身 cell')
  return cell.value
}
check('any one kind of training fills it', () => {
  // The six kinds, one at a time: the cell answers "did I train", so a single
  // record of any of them is a whole trained day.
  const trainings: readonly (readonly [string, Record<string, unknown>])[] = [
    ['running', { run: { at: 'x', minutes: 30, distanceKm: 5 } }],
    ['jump rope', { rope: [{ id: 'r', at: 'x', preset: 90, seconds: 40 }] }],
    ['pull-ups', { pullup: [{ id: 'u', at: 'x', seconds: 20 }] }],
    ['plank', { plank: [{ id: 'p', at: 'x', seconds: 45 }] }],
    ['equipment', { equipment: [{ id: 'e', at: 'x', name: '划船机', reps: 20 }] }],
    ['free', { free: [{ id: 'f', at: 'x', minutes: 30 }] }],
  ]
  for (const [label, patch] of trainings) assert.equal(sportOf(patch), 1, `${label} alone trains the day`)
  assert.equal(sportOf({}), 0, 'and a day with no training leaves it empty')
})
check('the non-training habits cannot fill it', () => {
  // The broken state this guards: a cell that greens up for anything recorded
  // that day. Washing clothes and studying are records, not training.
  const others: readonly (readonly [string, Record<string, unknown>])[] = [
    ['a wash', { washes: { times: ['a', 'b'] } }],
    ['a shower', { shower: { at: 'x' } }],
    ['a meal', { meals: { breakfast: { at: 'x' } } }],
    ['vocabulary', { vocab: { target: { new: 1, review: 0 }, sessions: [{ id: 'v', at: 'x', new: 1, review: 0, minutes: 5 }] } }],
    ['duolingo', { duolingo: [{ id: 'd', at: 'x', minutes: 10 }] }],
    ['a laundry session', { washing: [{ id: 'w', at: 'x', pieces: 3 }] }],
  ]
  for (const [label, patch] of others) assert.equal(sportOf(patch), 0, `${label} is not training`)
})
check('健身 达标 is the same cell rule as every other habit', () => {
  const trained = dayRecord.parse({ date: '2026-09-16', free: [{ id: 'f', at: 'x', minutes: 30 }] })
  const values = new Map(dayCells(trained).map(cell => [cell.id, cell.value]))
  const valueOf = (id: CellId): number => values.get(id) ?? 0
  assert.equal(habitMet(habitOf('sport'), valueOf), true)
  assert.equal(habitMet(habitOf('sport'), () => 0), false)
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
