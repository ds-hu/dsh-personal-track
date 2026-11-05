/**
 * Jump rope: one record a day, with a free count.
 *
 * A document written before that rule stored a *set* per preset (90 or 180
 * jumps), several sets a day. Both shapes meet here: {@link ropeCount} reads
 * whichever field a record carries, and {@link mergeRope} folds a day's legacy
 * sets into the one record the board, the report and the statistics show.
 * Merging is a **read** rule — nothing is rewritten until the day is edited, so
 * an old document stays exactly as it was written.
 */
export interface RopeSet {
  readonly id: string
  readonly at: string
  /** Jumps in this record. Absent only on a legacy preset set. */
  readonly count?: number
  /** Legacy fixed-count set; kept so old documents and backups still parse. */
  readonly preset?: 90 | 180
  readonly seconds: number
  readonly avgHr?: number
}

/** One day's rope, after any legacy sets have been merged. */
export interface RopeDay {
  readonly id: string
  readonly at: string
  readonly count: number
  readonly seconds: number
  readonly avgHr?: number
}

/** Jumps in one record, reading the legacy preset when that is all it carries. */
export function ropeCount(set: RopeSet): number {
  return set.count ?? set.preset ?? 0
}

/** Jumps per minute; undefined when no duration was recorded. */
export function ropeTempo(count: number, seconds: number): number | undefined {
  return seconds > 0 ? (count * 60) / seconds : undefined
}

/**
 * Fold one day's records into the single one the view shows.
 *
 * The earliest instant becomes the record's time (when the day's first set
 * started), counts and seconds add up, and the heart rate is weighted by time —
 * a 20-minute record says more about the session than a 30-second one. It is
 * absent entirely until some record measured one, exactly like a run's average.
 */
export function mergeRope(sets: readonly RopeSet[]): RopeDay | null {
  if (sets.length === 0) return null
  let earliest = sets[0]!
  let count = 0
  let seconds = 0
  let weighted = 0
  let weight = 0
  let plain = 0
  let measured = 0
  for (const set of sets) {
    if (set.at < earliest.at) earliest = set
    count += ropeCount(set)
    seconds += set.seconds
    if (set.avgHr === undefined) continue
    measured += 1
    plain += set.avgHr
    weighted += set.avgHr * set.seconds
    weight += set.seconds
  }
  const avgHr = measured === 0
    ? undefined
    : Math.round(weight > 0 ? weighted / weight : plain / measured)
  return {
    id: earliest.id,
    at: earliest.at,
    count,
    seconds,
    ...(avgHr === undefined ? {} : { avgHr }),
  }
}

/** `45 秒`, `10 分`, `12.5 分` — how the report and the card print a duration. */
export function ropeDurationText(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.round((seconds / 60) * 10) / 10} 分`
}
