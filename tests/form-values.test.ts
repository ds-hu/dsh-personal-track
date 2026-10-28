/**
 * What a form's inputs start with — the rule that decides between "the entry's
 * value" and "the field's default".
 *
 * The defect this file exists for: the running tile opened its editor on a day
 * with no run and showed an empty time input, because it passed
 * `initial.time = timeValueOf(undefined)`, which is `''` — and `''` was treated
 * as a value, so it beat the current-clock default the time field carries. The
 * rule had been written inline in `FieldForm`, where no test could reach it, so
 * it lives in `form-values.ts` now and is asserted here without a DOM.
 *
 * Runs on Node's native type stripping:
 *   node tests/form-values.test.ts
 */
import { strict as assert } from 'node:assert'
import { initialValuesOf } from '../src/client/board/form-values.ts'
import type { FieldSpec } from '../src/client/board/fields.tsx'
import { timeField, TIME_FIELD } from '../src/client/board/format.ts'

let passed = 0

/** Run one labelled case. */
function check(label: string, fn: () => void): void {
  fn()
  passed += 1
  console.log(`  ✓ ${label}`)
}

/** A field with a default, and an optional one without — the two shapes in use. */
const FIELDS: readonly FieldSpec[] = [
  { name: 'time', label: '时间', kind: 'time', defaultValue: '09:41' },
  { name: 'minutes', label: '时长(分)', kind: 'number', defaultValue: '30' },
  { name: 'avgHr', label: '平均心率', kind: 'number', optional: true },
]

console.log('a new entry starts from the field defaults')
check('no initial at all gives every field its own default', () => {
  assert.deepEqual(initialValuesOf(FIELDS), { time: '09:41', minutes: '30', avgHr: '' })
})
check('an optional field with no default starts empty, not undefined', () => {
  assert.equal(initialValuesOf(FIELDS).avgHr, '', 'the input value is a string')
})

console.log('an empty initial is not a value')
check('an empty string falls back to the default', () => {
  // Exactly what the running tile handed over: `timeValueOf(undefined)` is `''`.
  // Treating it as a value is the bug — the clock input then opened blank.
  assert.equal(initialValuesOf(FIELDS, { time: '' }).time, '09:41')
  assert.equal(initialValuesOf(FIELDS, { minutes: '' }).minutes, '30')
})
check('null and an absent key behave the same way', () => {
  assert.equal(initialValuesOf(FIELDS, { time: null }).time, '09:41')
  assert.equal(initialValuesOf(FIELDS, { minutes: undefined }).minutes, '30')
})

console.log('a real initial wins, including the falsy ones that are values')
check('an existing entry overrides the default', () => {
  assert.equal(initialValuesOf(FIELDS, { time: '08:15', minutes: 42 }).time, '08:15')
  assert.equal(initialValuesOf(FIELDS, { minutes: 42 }).minutes, '42')
})
check('zero is a value, not an absence', () => {
  // A heart rate of 0 is nonsense, but the rule must not special-case numbers:
  // "absent" is about the *shape* of nothing, and 0 is not that shape.
  assert.equal(initialValuesOf(FIELDS, { avgHr: 0 }).avgHr, '0')
})
check('a field the initial does not mention keeps its default', () => {
  const values = initialValuesOf(FIELDS, { time: '08:15' })
  assert.equal(values.minutes, '30', 'editing one field does not blank the rest')
})

console.log('the running tile\'s own field set')
check('a fresh run opens on the current clock, an edited one on its own instant', () => {
  // The two calls `RunTile` makes: no entry at all, then an existing one.
  const fresh = initialValuesOf([timeField()])
  assert.match(String(fresh.time), /^([01]\d|2[0-3]):[0-5]\d$/, 'the clock, as the tile now opens')

  const edited = initialValuesOf([timeField()], { time: '07:03' })
  assert.equal(edited.time, '07:03', 'and an edited run keeps the instant it was recorded at')
})
check('the shared time constant carries no default of its own', () => {
  // `timeField()` builds a fresh default per call; a default baked into the
  // constant would freeze at import and drift away from the clock.
  assert.equal(Object.hasOwn(TIME_FIELD, 'defaultValue'), false)
})

console.log(`\n${passed} checks passed`)
