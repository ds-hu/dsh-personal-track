/**
 * The time ledger: two writers, one day.
 *
 * The bug this guards: `write` once read the day with `get` and wrote it back
 * with `put`. On the real domain a `put` is durable **before** the record
 * becomes readable, so two deletes landing together both read the document as
 * it was before either of them and the second put erased the first one's focus
 * session — after the entry it came from had already been deleted, so nothing
 * could rebuild it.
 *
 * The fake only reproduces that ordering when writes are delayed
 * (`memoryDomain({ writeDelayMs })`); with an instant write both writers see
 * each other's rows and the race hides.
 *
 * Runs on Node's native type stripping:
 *   node tests/time-ledger.test.ts
 */
import { strict as assert } from 'node:assert'
import type { TimeItem } from '../src/host/domain.ts'
import { createLedger } from '../src/host/ledger.ts'
import { createChecker, memoryDomain } from './support.ts'

const checker = createChecker('time ledger')
const { checkAsync, report } = checker

const DAY = '2026-09-16'

/** One deleted entry's session, as the store files it. */
function focusOf(id: string): TimeItem {
  return {
    kind: 'focus',
    id,
    entry: `entry-${id}`,
    entryKind: 'task',
    title: id,
    startedAt: '2026-09-16T10:00:00Z',
    endedAt: '2026-09-16T10:30:00Z',
  }
}

await checkAsync('two writers landing at once keep both rows', async () => {
  const domain = memoryDomain({ writeDelayMs: 20 })
  // Two handles on one domain: the store and the presence store each build
  // their own, so the atomicity has to come from the table, not from a chain
  // one of them happens to own.
  const left = createLedger(domain)
  const right = createLedger(domain)
  await Promise.all([
    left.write(DAY, [focusOf('fa')]),
    right.write(DAY, [focusOf('fb')]),
  ])
  assert.deepEqual(
    left.read(DAY).map(item => item.id).sort(),
    ['fa', 'fb'],
    'a lost update would drop one of the two deleted entries’ sessions',
  )
})

await checkAsync('the same row written twice is stored once', async () => {
  const domain = memoryDomain()
  const ledger = createLedger(domain)
  await ledger.write(DAY, [focusOf('fa')])
  await ledger.write(DAY, [focusOf('fa')])
  assert.deepEqual(ledger.read(DAY).map(item => item.id), ['fa'])
})

await checkAsync('a deletion interrupted before the record delete writes no duplicate', async () => {
  // What a retried delete does: the same ids arrive again after the first
  // attempt got as far as the ledger.
  const domain = memoryDomain()
  const ledger = createLedger(domain)
  const items = [focusOf('fa'), focusOf('fb')]
  await ledger.write(DAY, items)
  await ledger.write(DAY, items)
  assert.deepEqual(ledger.read(DAY).map(item => item.id), ['fa', 'fb'])
})

await checkAsync('a day with nothing to keep has no document', async () => {
  const domain = memoryDomain()
  const ledger = createLedger(domain)
  await ledger.write(DAY, [])
  assert.equal(domain.table('time').size, 0, 'an empty ledger day is not a day')
})

report()
