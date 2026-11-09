/**
 * The panel's dictionary, asserted rather than assumed.
 *
 * Most of the i18n contract is structural: `copy/table.ts` is one row per
 * message, and both dictionaries are projected from it, so "the two key sets
 * are equal" cannot be false. What a compiler cannot see is the *content* of a
 * row — a placeholder spelled `{count}` on one side and `{n}` on the other
 * renders as a literal `{n}`, in the language the author was not looking at.
 * That is what this file checks.
 *
 * Runs on Node's native type stripping:
 *   node tests/copy.test.ts
 */
import { strict as assert } from 'node:assert'
import { COPY, EN, ZH, dictionaryOf, type CopyKey } from '../src/client/copy/table.ts'
import { createChecker } from './support.ts'

const { check, report } = createChecker('the copy table: one row, two languages that agree')

/** Placeholder names in a template, in order. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map(match => match[1]!)
}

console.log('the table')

check('every row carries both languages, and the English carries no Chinese', () => {
  // An identical pair is allowed: `{kcal} kcal` says the same thing in both and
  // forcing a difference would be worse than sharing it. What is never allowed
  // is Chinese that survived on the English side — that is a row somebody meant
  // to translate and did not.
  for (const [key, row] of Object.entries(COPY)) {
    assert.notEqual(row.zh.trim(), '', `${key} has no Chinese`)
    assert.notEqual(row.en.trim(), '', `${key} has no English`)
    assert.doesNotMatch(row.en, /\p{Script=Han}/u, `${key} still reads in Chinese on the English side`)
  }
})

check('both dictionaries cover exactly the table, key for key', () => {
  const keys = Object.keys(COPY).sort()
  assert.deepEqual(Object.keys(ZH).sort(), keys)
  assert.deepEqual(Object.keys(EN).sort(), keys)
})

check('a row that takes figures takes the same ones in both languages', () => {
  for (const [key, row] of Object.entries(COPY)) {
    assert.deepEqual(
      placeholders(row.en),
      placeholders(row.zh),
      `${key} spells its placeholders differently in the two languages`,
    )
  }
})

check('the staged sentence and the import summary name the same record classes', () => {
  // Two sentences about one file — what it carries, before and after the write.
  // A class added to one and forgotten in the other is how the import panel came
  // to report two registries while the write underneath it moved three, and the
  // third one was the one a `replace` could destroy in silence.
  for (const language of ['zh', 'en'] as const) {
    assert.deepEqual(
      placeholders(COPY['data.imported'][language]),
      placeholders(COPY['data.staged'][language]),
      `data.imported and data.staged disagree on what an import carries (${language})`,
    )
  }
})

check('every language keeps its own copy of every row', () => {
  // A projected dictionary must not alias the table: a later edit cannot leak
  // one language into the other through a shared object.
  for (const key of Object.keys(COPY) as CopyKey[]) {
    assert.equal(typeof dictionaryOf('zh')[key], 'string')
    assert.equal(ZH[key], COPY[key].zh)
    assert.equal(EN[key], COPY[key].en)
  }
})

check('a rendered sentence keeps no braces once its figures are filled in', () => {
  const filled = (template: string): string =>
    template.replace(/\{(\w+)\}/g, (_, name: string) => (name === 'count' ? '3' : 'X'))
  for (const [key, row] of Object.entries(COPY)) {
    for (const template of [row.zh, row.en]) {
      assert.doesNotMatch(filled(template), /\{\w+\}/, `${key} leaves a placeholder unfilled`)
    }
  }
})

report()
