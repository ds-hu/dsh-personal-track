/**
 * The heart-rate / pace curve's arithmetic: which runs are worth comparing, and
 * which of those are not beaten by another.
 *
 * A pace only means something next to a run of the same distance — a 1 km sprint
 * is always faster than a 4 km jog — so points are bucketed by whole kilometres,
 * and each bucket gets its own colour and its own frontier. Nothing here knows
 * about dates: the chart used to join consecutive runs in date order, which drew
 * a line between two points that have nothing to do with each other (the x axis
 * is pace, not time). Inside a bucket the order is by pace, the axis the bucket
 * actually shares.
 *
 * Both axes point the same way — faster is further right, lower heart rate is
 * further down — so "better" is down-and-right and an un-dominated point sits on
 * a staircase that only ever steps down as it moves left (slower).
 */
import type { RunPoint } from '../types.ts'

/** One distance bucket: its runs, the fastest first, and its frontier. */
export interface RunCluster {
  /**
   * The bucket's distance in whole kilometres, which is also its name: a 3.62 km
   * run is in the 4 km bucket, and the tooltip still carries the exact distance.
   */
  readonly key: number
  /** The bucket's runs, sorted by pace (fastest first), then by date. */
  readonly points: readonly RunPoint[]
  /**
   * The runs inside this bucket that no other run in it beats — faster *and* at
   * no higher a heart rate. Drawn as a dashed staircase; fewer than two of them
   * is drawn as a single ring, since one point is not a line.
   */
  readonly frontier: readonly RunPoint[]
}

/**
 * The bucket a distance belongs to.
 *
 * Nearest whole kilometre rather than a fixed band (`2–3.5 km` and friends):
 * bands invent thresholds that go stale as soon as the training changes, while
 * rounding has no number to tune and lets the bucket count follow the data.
 * Rounded rather than floored so that 4.13 km and 4.04 km — the same run, as far
 * as a watch is concerned — stay together. A run shorter than half a kilometre
 * is still a run, so the floor is 1.
 */
export function clusterKey(km: number): number {
  if (!Number.isFinite(km) || km <= 0) return 1
  return Math.max(1, Math.floor(km + 0.5))
}

/**
 * The runs on the frontier of one bucket: for each, nothing at least as fast has
 * a lower heart rate.
 *
 * Equal paces are collapsed first (keeping the lower reading) so a run recorded
 * twice cannot put two dots in the same place, then a single pass keeps a point
 * only when its heart rate undercuts every faster run's — which also fixes the
 * order: fastest first, heart rate strictly falling.
 */
export function paretoFrontier(points: readonly RunPoint[]): readonly RunPoint[] {
  const lowestPerPace = new Map<number, RunPoint>()
  for (const point of points) {
    const held = lowestPerPace.get(point.pace)
    if (held === undefined || point.avgHr < held.avgHr) lowestPerPace.set(point.pace, point)
  }
  const byPace = [...lowestPerPace.values()].sort((left, right) => left.pace - right.pace)
  const frontier: RunPoint[] = []
  let lowest = Number.POSITIVE_INFINITY
  for (const point of byPace) {
    if (point.avgHr < lowest) {
      frontier.push(point)
      lowest = point.avgHr
    }
  }
  return frontier
}

/**
 * Bucket the range's runs by distance, nearest bucket first.
 *
 * The panel colours by this order, so the buckets come back ascending even when
 * the range holds only the two ends of a training cycle.
 */
export function clusterRuns(points: readonly RunPoint[]): readonly RunCluster[] {
  const buckets = new Map<number, RunPoint[]>()
  for (const point of points) {
    const key = clusterKey(point.km)
    const held = buckets.get(key)
    if (held === undefined) buckets.set(key, [point])
    else held.push(point)
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([key, group]) => {
      const points = [...group].sort((left, right) =>
        left.pace - right.pace || left.date.localeCompare(right.date))
      return { key, points, frontier: paretoFrontier(points) }
    })
}
