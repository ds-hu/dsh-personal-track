/**
 * Jump-rope rules: several sets a day, a free count, and the legacy documents
 * that still carry one record or a list of preset sets.
 *
 * The merge is where a day's sets become the totals the card, the report and
 * the statistics read, so the cases that matter are the ones a hand-written
 * document can produce: sets out of order, a measurement on only one of them,
 * and a zero-length record.
 */
import { strict as assert } from 'node:assert'
import {
  mergeRope,
  ropeCount,
  ropeDurationOf,
  ropeTempo,
} from '../src/shared/rope.ts'
import { createChecker } from './support.ts'

const { check, report } = createChecker('jump rope: a free count over the legacy sets')

console.log('the count a record carries')
check('a free count wins, and a legacy preset is read as the count', () => {
  assert.equal(ropeCount({ id: 'r', at: 'x', count: 120, seconds: 60 }), 120)
  assert.equal(ropeCount({ id: 'r', at: 'x', preset: 90, seconds: 60 }), 90)
})
check('a record carrying both reads the free count', () => {
  // Only a hand-edited document can produce this; the free field is the newer
  // fact, so it wins rather than the preset quietly overriding it.
  assert.equal(ropeCount({ id: 'r', at: 'x', count: 120, preset: 180, seconds: 60 }), 120)
})

console.log('tempo (jumps per minute)')
check('count over minutes, with seconds in the denominator', () => {
  assert.equal(ropeTempo(1200, 600), 120)
  assert.equal(ropeTempo(90, 45), 120)
})
check('a zero-length record has no rate instead of an infinity', () => {
  assert.equal(ropeTempo(100, 0), undefined)
})

console.log('merging a day')
check('nothing recorded is nothing, not a zero record', () => {
  assert.equal(mergeRope([]), null)
})
check('one set is its own total, and says so', () => {
  assert.deepEqual(
    mergeRope([{ id: 'r1', at: '2026-09-20T10:00:00', count: 300, seconds: 120, avgHr: 130 }]),
    { id: 'r1', at: '2026-09-20T10:00:00', sets: 1, count: 300, seconds: 120, avgHr: 130 },
  )
})
check('a day of sets: earliest time, added counts and seconds, weighted heart rate', () => {
  const merged = mergeRope([
    { id: 'r1', at: '2026-09-20T10:00:00', preset: 90, seconds: 60, avgHr: 120 },
    { id: 'r2', at: '2026-09-20T09:30:00', preset: 180, seconds: 120, avgHr: 150 },
  ])
  assert.deepEqual(merged, {
    id: 'r2',
    at: '2026-09-20T09:30:00',
    sets: 2,
    count: 270,
    seconds: 180,
    // (120×60 + 150×120) / 180
    avgHr: 140,
  })
})
check('free counts add up the same way a preset list did', () => {
  // The shape a board write produces now: two sets, both with a free count.
  const merged = mergeRope([
    { id: 'r1', at: '2026-11-09T20:14:00', count: 480, seconds: 480, avgHr: 128 },
    { id: 'r2', at: '2026-11-09T20:31:00', count: 400, seconds: 420, avgHr: 134 },
  ])
  assert.equal(merged?.sets, 2)
  assert.equal(merged?.count, 880)
  assert.equal(merged?.seconds, 900)
  assert.equal(merged?.avgHr, 131)
})
check('an unmeasured set does not dilute the average', () => {
  assert.equal(
    mergeRope([
      { id: 'r1', at: 'a', count: 100, seconds: 60, avgHr: 120 },
      { id: 'r2', at: 'b', count: 100, seconds: 60 },
    ])?.avgHr,
    120,
  )
})
check('with no duration at all the average falls back to a plain mean', () => {
  // Two zero-length records cannot be weighted; the reading still exists, so it
  // is averaged rather than dropped.
  assert.equal(
    mergeRope([
      { id: 'r1', at: 'a', count: 1, seconds: 0, avgHr: 100 },
      { id: 'r2', at: 'b', count: 1, seconds: 0, avgHr: 140 },
    ])?.avgHr,
    120,
  )
})
check('a day with no measurement has no average, like a run without a strap', () => {
  assert.equal(mergeRope([{ id: 'r1', at: 'a', count: 100, seconds: 60 }])?.avgHr, undefined)
})

// The shared half decides the *unit* only; the words are the panel's.
console.log('how a duration is measured')
check('under a minute keeps its seconds; a minute or more reads in minutes', () => {
  assert.deepEqual(ropeDurationOf(45), { unit: 'seconds', value: 45 })
  assert.deepEqual(ropeDurationOf(0), { unit: 'seconds', value: 0 })
  assert.deepEqual(ropeDurationOf(59), { unit: 'seconds', value: 59 })
  assert.deepEqual(ropeDurationOf(60), { unit: 'minutes', value: 1 })
  assert.deepEqual(ropeDurationOf(90), { unit: 'minutes', value: 1.5 })
  // Rounded to one decimal, the same rule the card has always printed.
  assert.deepEqual(ropeDurationOf(100), { unit: 'minutes', value: 1.7 })
})

report()
