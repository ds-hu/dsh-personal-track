/**
 * What a form's inputs start with — the one rule, and the one place it broke.
 *
 * A field is pre-filled by an existing entry when there is one, and by its own
 * `defaultValue` otherwise. The distinction between "no entry" and "an entry
 * whose value is empty" is the whole rule, and it has to be made here rather
 * than at each call site: a caller that has no entry to offer naturally hands
 * over `''` (an empty string is what `timeValueOf(undefined)` returns, and what
 * an absent field reads as), and an initial of `''` then looks like a value. It
 * wins over `defaultValue`, so the input opens blank instead of opening on the
 * default.
 *
 * That is exactly how the running tile lost its clock time: it passed
 * `initial={{ time: timeValueOf(run?.at) }}` on a day with no run, which is
 * `''`, which overrode the "now" the time field carries. Pulling the rule out of
 * the component is what makes it assertable without a DOM, and it is the same
 * treatment `format.ts` gives the rest of the display rules.
 *
 * Pure and framework-free: `FieldSpec` is a type-only import, so this module
 * loads in Node without dragging JSX in.
 */
import type { FieldSpec } from './fields.tsx'

/**
 * Whether a value counts as "no entry" rather than as a value to show.
 *
 * `undefined` and `null` are the caller saying "I have nothing"; `''` is the
 * same statement spelled by every formatter in this project, so it means the
 * same thing here.
 */
function absent(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * The initial input values for one form.
 *
 * @param fields - the form's field descriptions, in render order.
 * @param initial - the entry being edited, when there is one.
 * @returns one string per field: the entry's value, or the field's own default.
 */
export function initialValuesOf(
  fields: readonly FieldSpec[],
  initial?: Readonly<Record<string, unknown>>,
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    const existing = initial?.[field.name]
    values[field.name] = absent(existing) ? field.defaultValue ?? '' : String(existing)
  }
  return values
}
