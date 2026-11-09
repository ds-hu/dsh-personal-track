/**
 * Jump rope: several sets a day, with a free count.
 *
 * A day is a list — you jump, rest, jump again — and each set is its own record
 * with its own time, count and heart rate. {@link mergeRope} folds them into the
 * day's totals, which is what the card's head, the report and the statistics
 * show: nobody wants to add up four sets in their head to know what they did.
 *
 * Documents written before this rule stored one record a day, and older ones
 * *preset* sets (90 or 180 jumps); nothing is rewritten, so {@link ropeCount}
 * reads whichever field a record carries and the totals are right either way.
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

/** One day's rope, summed over its sets. */
export interface RopeDay {
  /** The earliest set's id, so the totals still name where the day started. */
  readonly id: string
  /** And its instant: when the day's first set began. */
  readonly at: string
  /** How many sets went into the totals. */
  readonly sets: number
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
 * Fold one day's sets into the totals the view shows.
 *
 * The earliest instant becomes the day's time (when it started), counts and
 * seconds add up, and the heart rate is weighted by time — a 20-minute set says
 * more about the session than a 30-second one. It is absent entirely until some
 * set measured one, exactly like a run's average.
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
    sets: sets.length,
    count,
    seconds,
    ...(avgHr === undefined ? {} : { avgHr }),
  }
}

/**
 * How a duration should read: whole seconds below a minute, otherwise minutes
 * with at most one decimal.
 *
 * The *unit* is a domain decision (a 45-second session is "45 seconds", not
 * "0.75 minutes"), so it lives here with the arithmetic; the words are the
 * panel's, because they are translated and this module is shared with the host
 * (`ropeDurationText` used to return `45 秒` outright, which made the shared
 * half of the plugin own a language).
 */
export interface RopeDuration {
  readonly unit: 'seconds' | 'minutes'
  readonly value: number
}

/** The unit and figure for a duration in seconds. */
export function ropeDurationOf(seconds: number): RopeDuration {
  if (seconds < 60) return { unit: 'seconds', value: seconds }
  return { unit: 'minutes', value: Math.round((seconds / 60) * 10) / 10 }
}
