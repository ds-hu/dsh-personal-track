/**
 * The run curve's rules: which runs are comparable, and which of them nothing
 * beats.
 *
 * The two decisions worth pinning down live here rather than in the chart. First,
 * a distance belongs to exactly one bucket, and the bucket is what makes a pace
 * mean anything — so the edge cases are the half-kilometre boundary and the run
 * shorter than one. Second, a frontier is per bucket: the cases below show what
 * a *global* frontier would collapse to on this machine's own records, which is
 * the argument for not computing one.
 */
import { strict as assert } from 'node:assert'
import type { RunPoint } from '../src/client/types.ts'
import { clusterKey, clusterRuns, paretoFrontier } from '../src/client/board/run-curve.ts'
import { createChecker } from './support.ts'

const { check, report } = createChecker('run curve: a bucket per distance, a frontier per bucket')

/** One run, with the clock fields the chart's tooltip never needs. */
function run(date: string, km: number, pace: number, avgHr: number): RunPoint {
  return { date, km, pace, avgHr, minutes: Math.round(km * pace * 10) / 10 }
}

console.log('which distance bucket a run lands in')
check('nearest whole kilometre, so a watch\'s drift cannot split a bucket', () => {
  assert.equal(clusterKey(4.04), 4)
  assert.equal(clusterKey(4.13), 4)
  assert.equal(clusterKey(3.62), 4)
  assert.equal(clusterKey(4.35), 4)
})
check('a half kilometre rounds up, a hair under rounds down', () => {
  assert.equal(clusterKey(1.49), 1)
  assert.equal(clusterKey(1.5), 2)
  assert.equal(clusterKey(4.5), 5)
})
check('a run shorter than half a kilometre is still a run, not bucket zero', () => {
  assert.equal(clusterKey(0.4), 1)
  assert.equal(clusterKey(0.001), 1)
})
check('a nonsense distance falls back to the shortest bucket', () => {
  assert.equal(clusterKey(0), 1)
  assert.equal(clusterKey(-3), 1)
  assert.equal(clusterKey(Number.NaN), 1)
})
check('a half marathon is its own bucket, not a cap', () => {
  assert.equal(clusterKey(21.0975), 21)
})

console.log('the frontier of one bucket')
check('nothing on the frontier is beaten by a faster run at no higher heart rate', () => {
  const line = paretoFrontier([run('a', 4, 5, 150), run('b', 4, 5.5, 160)])
  assert.deepEqual(line.map(point => point.date), ['a'])
})
check('slower but calmer stays on the frontier', () => {
  const line = paretoFrontier([run('a', 4, 5, 160), run('b', 4, 6, 150)])
  assert.deepEqual(line.map(point => point.date), ['a', 'b'])
})
check('two runs at the same pace collapse to the lower reading', () => {
  const line = paretoFrontier([run('a', 4, 5, 160), run('b', 4, 5, 150)])
  assert.deepEqual(line.map(point => point.date), ['b'])
})
check('a slower run at the same heart rate is dominated', () => {
  const line = paretoFrontier([run('a', 4, 5, 150), run('b', 4, 6, 150)])
  assert.deepEqual(line.map(point => point.date), ['a'])
})
check('the frontier runs fastest-first with a strictly falling heart rate', () => {
  const line = paretoFrontier([
    run('slow', 3, 6.1, 179),
    run('mid', 3, 5.9, 185),
    run('fast', 3, 5.6, 187),
    run('worse', 3, 5.7, 190),
  ])
  assert.deepEqual(line.map(point => point.date), ['fast', 'mid', 'slow'])
  const rates = line.map(point => point.avgHr)
  assert.deepEqual(rates, [...rates].sort((left, right) => right - left))
})
check('an empty range has an empty frontier, and a single run is its own', () => {
  assert.deepEqual(paretoFrontier([]), [])
  assert.deepEqual(paretoFrontier([run('only', 4, 6, 150)]).map(point => point.date), ['only'])
})

console.log('bucketing a range')
check('buckets come back shortest-first even when the range does not', () => {
  const clusters = clusterRuns([run('a', 4.2, 7, 160), run('b', 1.1, 5, 170), run('c', 3.1, 6, 175)])
  assert.deepEqual(clusters.map(cluster => cluster.key), [1, 3, 4])
  assert.deepEqual(clusters.map(cluster => cluster.points.length), [1, 1, 1])
})
check('inside a bucket the runs are ordered by pace, not by date', () => {
  const clusters = clusterRuns([run('later', 1, 5.9, 166), run('earlier', 1, 4.1, 157)])
  assert.deepEqual(clusters[0]?.points.map(point => point.date), ['earlier', 'later'])
})
check('a bucket with one run has a one-point frontier, not a line', () => {
  const clusters = clusterRuns([run('a', 1, 4.1, 157)])
  assert.equal(clusters[0]?.frontier.length, 1)
})

console.log('the machine\'s own fifteen runs')
/*
 * The regression fixture: every run recorded so far, with the pace the host
 * derives. It is the shape the panel has to render — three buckets, one of them
 * degenerate — rather than a synthetic arrangement of dots.
 */
const RECORDS: readonly RunPoint[] = [
  run('2026-09-11', 3.62, 8.3, 150),
  run('2026-09-13', 3.82, 7.9, 159),
  run('2026-09-15', 4.13, 7.3, 163),
  run('2026-09-17', 4.04, 7.4, 164),
  run('2026-09-21', 1.27, 5.9, 166),
  run('2026-09-22', 3, 6.1, 179),
  run('2026-09-29', 1, 4.8, 187),
  run('2026-10-10', 4.13, 7.3, 168),
  run('2026-10-11', 4.22, 7.1, 164),
  run('2026-10-19', 3, 5.9, 185),
  run('2026-10-21', 3.62, 8.3, 155),
  run('2026-10-26', 3, 5.6, 187),
  run('2026-10-28', 1, 4.1, 157),
  run('2026-10-31', 1, 4.2, 162),
  run('2026-11-04', 4.35, 6.9, 157),
]

check('three buckets, and the longest holds most of the runs', () => {
  const clusters = clusterRuns(RECORDS)
  assert.deepEqual(clusters.map(cluster => cluster.key), [1, 3, 4])
  assert.deepEqual(clusters.map(cluster => cluster.points.length), [4, 3, 8])
})
check('one bucket can have a single frontier point', () => {
  const one = clusterRuns(RECORDS).find(cluster => cluster.key === 1)
  assert.deepEqual(one?.frontier.map(point => point.date), ['2026-10-28'])
})
check('the frontier of a bucket is the best trade-off at that distance', () => {
  const clusters = clusterRuns(RECORDS)
  assert.deepEqual(
    clusters.find(cluster => cluster.key === 3)?.frontier.map(point => point.date),
    ['2026-10-26', '2026-10-19', '2026-09-22'],
  )
  assert.deepEqual(
    clusters.find(cluster => cluster.key === 4)?.frontier.map(point => point.date),
    ['2026-11-04', '2026-09-11'],
  )
})
check('a global frontier would keep two runs from two different distances', () => {
  // The argument for bucketing, in numbers: over every run at once the frontier
  // is the fastest 1 km and the calmest 4 km — a short sprint and a long jog,
  // which says nothing about either distance.
  const everywhere = paretoFrontier(RECORDS)
  assert.deepEqual(everywhere.map(point => point.date), ['2026-10-28', '2026-09-11'])
  assert.deepEqual(everywhere.map(point => clusterKey(point.km)), [1, 4])
})

report()
