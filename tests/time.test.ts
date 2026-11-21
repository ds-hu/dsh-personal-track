/**
 * The one-day time view and its union arithmetic.
 *
 * Two things are asserted here because they are the two places a total can
 * silently lie:
 *
 * - a row's total is the **sum** of its intervals, while the overview's total is
 *   the **union** — the fixture deliberately overlaps a vocabulary session with
 *   a focus session and a Duolingo lesson with the same focus session, so the
 *   difference between 19,065 and 19,965 seconds is visible;
 * - a record's `at` is its **end**, so the vocabulary block starts at 08:25
 *   when the record says 09:10 and 45 minutes.
 *
 * Runs on Node's native type stripping:
 *   node tests/time.test.ts
 */
import { strict as assert } from 'node:assert'
import { boundaryOf } from '../src/host/config.ts'
import { mediaRecord } from '../src/host/domain.ts'
import { buildTime } from '../src/host/time.ts'
import { mergeSpans, splitBySource, subtractIntervals, subtractSpans, unionSeconds } from '../src/shared/time-union.ts'
import { createChecker, createHarness } from './support.ts'

const checker = createChecker('one-day time view')
const { check, checkAsync, report } = checker

const DATE = '2026-11-19'

/** A media entry with closed sessions, an open one and a previous-day one. */
function reportEntry(): ReturnType<typeof mediaRecord.parse> {
  return mediaRecord.parse({
    id: 'm1',
    kind: 'book',
    title: '周报',
    status: 'active',
    createdAt: '2026-11-19T08:00:00+08:00',
    focusSessions: [
      { id: 's1', startedAt: '2026-11-19T09:00:00+08:00', endedAt: '2026-11-19T09:45:00+08:00' },
      { id: 's2', startedAt: '2026-11-19T10:00:00+08:00', endedAt: '2026-11-19T10:30:00+08:00' },
      { id: 'open', startedAt: '2026-11-19T13:00:00+08:00' },
      { id: 'yesterday', startedAt: '2026-11-18T23:00:00+08:00', endedAt: '2026-11-18T23:30:00+08:00' },
    ],
  })
}

/** The fixture day: ten record rows, two of them overlapping the focus entry. */
async function fixture(): Promise<{ store: ReturnType<typeof createHarness>['store']; boundary: ReturnType<typeof boundaryOf> }> {
  const api = createHarness()
  await api.store.putMedia(reportEntry())
  await api.store.mutateDay(DATE, day => ({
    ...day,
    vocab: {
      target: { new: 0, review: 0 },
      sessions: [
        { id: 'v1', at: '2026-11-19T09:10:00+08:00', new: 0, review: 0, minutes: 45 },
        { id: 'v2', at: '2026-11-19T21:00:00+08:00', new: 0, review: 0, minutes: 30 },
      ],
    },
    duolingo: [{ id: 'd1', at: '2026-11-19T09:58:00+08:00', minutes: 18 }],
    run: { at: '2026-11-19T07:10:00+08:00', minutes: 30, distanceKm: 5 },
    rope: [{ id: 'r1', at: '2026-11-19T20:00:00+08:00', count: 90, seconds: 180 }],
    free: [{ id: 'f1', at: '2026-11-19T18:00:00+08:00', minutes: 45 }],
    pullup: [{ id: 'p1', at: '2026-11-19T21:30:00+08:00', seconds: 60 }],
    plank: [{ id: 'k1', at: '2026-11-19T21:40:00+08:00', seconds: 45 }],
    washes: { times: ['2026-11-19T07:24:00+08:00', '2026-11-19T22:10:00+08:00'] },
    shower: { at: '2026-11-19T22:31:00+08:00' },
    meals: {
      breakfast: { at: '2026-11-19T07:52:00+08:00' },
      lunch: { at: '2026-11-19T12:18:00+08:00' },
      dinner: { at: '2026-11-19T18:40:00+08:00' },
    },
  }))
  return { store: api.store, boundary: boundaryOf(api.config) }
}

check('touching spans merge and a backwards span is dropped', () => {
  assert.deepEqual(mergeSpans([{ start: 0, end: 10 }, { start: 10, end: 20 }]), [{ start: 0, end: 20 }])
  assert.deepEqual(mergeSpans([{ start: 0, end: 10 }, { start: 5, end: 20 }]), [{ start: 0, end: 20 }])
  assert.deepEqual(mergeSpans([{ start: 0, end: 10 }, { start: 20, end: 10 }]), [{ start: 0, end: 10 }])
})

check('the union counts an overlap once and rounds once', () => {
  const intervals = [
    { startedAt: '2026-11-19T09:00:00+08:00', endedAt: '2026-11-19T09:45:00+08:00' },
    { startedAt: '2026-11-19T09:30:00+08:00', endedAt: '2026-11-19T09:58:00+08:00' },
  ]
  assert.equal(unionSeconds(intervals), 58 * 60, '09:00–09:58, not 45 + 28 minutes')
  assert.equal(unionSeconds([]), 0)
})

check('the focus deduction removes holes and keeps the unswept edges', () => {
  assert.deepEqual(
    subtractSpans([{ start: 0, end: 100 }], [{ start: 20, end: 30 }]),
    [{ start: 0, end: 20 }, { start: 30, end: 100 }],
  )
  assert.deepEqual(
    subtractSpans([{ start: 0, end: 100 }], [{ start: -10, end: 200 }]),
    [],
    'a hole covering the whole span leaves nothing',
  )
  assert.deepEqual(
    subtractSpans([{ start: 0, end: 10 }, { start: 20, end: 30 }], [{ start: 5, end: 25 }]),
    [{ start: 0, end: 5 }, { start: 25, end: 30 }],
    'one hole across two spans keeps both outer edges',
  )
  assert.deepEqual(
    subtractIntervals(
      [{ startedAt: '2026-11-19T09:00:00.000Z', endedAt: '2026-11-19T09:10:00.000Z' }],
      [{ startedAt: '2026-11-19T09:02:00.000Z', endedAt: '2026-11-19T09:04:00.000Z' }],
    ),
    [
      { startedAt: '2026-11-19T09:00:00.000Z', endedAt: '2026-11-19T09:02:00.000Z' },
      { startedAt: '2026-11-19T09:04:00.000Z', endedAt: '2026-11-19T09:10:00.000Z' },
    ],
    'the wire form keeps the same edges',
  )
})

check('a merged segment names exactly the sources active in it', () => {
  const segments = splitBySource([
    { source: 'focus', spans: [{ start: 0, end: 10 }, { start: 20, end: 30 }] },
    { source: 'record', spans: [{ start: 5, end: 25 }] },
  ])
  assert.deepEqual(segments, [
    { start: 0, end: 5, sources: ['focus'] },
    { start: 5, end: 10, sources: ['focus', 'record'] },
    { start: 10, end: 20, sources: ['record'] },
    { start: 20, end: 25, sources: ['focus', 'record'] },
    { start: 25, end: 30, sources: ['focus'] },
  ])
})

await checkAsync('a day derives focus, records and the union total from the stored facts', async () => {
  const { store, boundary } = await fixture()
  const view = buildTime({
    store,
    date: DATE,
    boundary,
    presence: { segments: [], prompts: [] },
    now: new Date('2026-11-19T23:00:00+08:00'),
  })

  assert.equal(view.date, DATE)
  assert.equal(view.from, '2026-11-18T20:00:00.000Z', 'the habit day starts at 04:00 +08:00')
  assert.equal(view.to, '2026-11-19T20:00:00.000Z')
  assert.equal(view.nightFrom, '2026-11-19T16:00:00.000Z', 'the night tail is the last four hours')
  assert.equal(view.ticks.length, 7)
  assert.deepEqual(view.ticks.map(tick => tick.label), ['04:00', '08:00', '12:00', '16:00', '20:00', '00:00', '04:00'])

  assert.equal(view.talk.length, 0, 'no presence observed, so no conversation rows')
  assert.equal(view.focus.length, 1)
  assert.equal(view.focus[0]?.title, '周报')
  assert.equal(view.focus[0]?.intervals.length, 2, 'the open session and the previous-day session are not rows')
  assert.equal(view.focus[0]?.seconds, (45 + 30) * 60)
  assert.equal(view.totals.focus, (45 + 30) * 60)

  assert.equal(view.records.length, 10)
  assert.equal(view.records[0]?.id, 'run')
  assert.deepEqual(view.records[0]?.intervals, [{
    startedAt: '2026-11-18T22:40:00.000Z',
    endedAt: '2026-11-18T23:10:00.000Z',
  }], 'a record’s at is its end, and its start is back-calculated')
  const vocab = view.records.find(row => row.id === 'vocab')
  assert.equal(vocab?.seconds, (45 + 30) * 60)
  assert.equal(vocab?.intervals[0]?.startedAt, '2026-11-19T00:25:00.000Z', '09:10 +08:00 minus 45 minutes')
  const meals = view.records.find(row => row.id === 'meals')
  assert.equal(meals?.seconds, 3 * 20 * 60)
  assert.equal(view.totals.records, 15_465, '45+30 vocab, 18 duolingo, 30 run, 3 rope, 45 free, 1 pull-up, 45s plank, 2×5 wash, 15 shower, 3×20 meals')

  // The 09:00–09:45 focus session overlaps the 08:25–09:10 vocabulary record
  // by ten minutes and the 09:40–09:58 Duolingo record by five; the union
  // removes both overlaps, while the group totals keep them.
  assert.equal(view.totals.covered, 19_065)
  assert.ok(view.totals.covered < view.totals.focus + view.totals.records)
})

await checkAsync('deleting the entry keeps its focus row, and the conversation it hid stays hidden', async () => {
  const { store, boundary } = await fixture()
  // One long visit 08:50–10:40 that runs across both of the entry's sessions.
  const presence = {
    segments: [{ sessionId: 'c1', startedAt: '2026-11-19T08:50:00+08:00', endedAt: '2026-11-19T10:40:00+08:00' }],
    prompts: [],
  }
  const now = new Date('2026-11-19T23:00:00+08:00')
  const before = buildTime({ store, date: DATE, boundary, presence, now })
  assert.deepEqual(before.focus.map(row => row.id), ['media:m1'])
  assert.equal(before.totals.talk, 35 * 60, 'the visit minus the two focused stretches')

  await store.deleteMedia('m1')
  const after = buildTime({ store, date: DATE, boundary, presence, now })
  assert.deepEqual(
    after.focus.map(row => [row.id, row.title, row.seconds]),
    [['media:m1', '周报', (45 + 30) * 60]],
    'the row is still there, under the title the entry had',
  )
  assert.equal(after.totals.focus, before.totals.focus, 'and the total did not move')
  assert.equal(after.totals.talk, before.totals.talk, 'nor did the conversation that focused time covered')
})

report()
