/**
 * Interval arithmetic for the one-day time view: **the one copy** of how a
 * day's recorded spans merge.
 *
 * The view draws intervals, but every total it prints is a **union**: two
 * devices in the same conversation, a record that overlaps a focus session, or
 * a check-in grabbed while a focus session runs must never be counted twice.
 * The browser draws those unions and the host prints their seconds, so the
 * arithmetic lives here — isomorphic, `Date` only, no `node:` imports, no DOM
 * — and the two halves cannot disagree about a total
 * (docs/adr/0002-derived-state-not-stored.md).
 *
 * Intervals arrive as instants because that is what the wire carries; they are
 * converted to epoch milliseconds once, and an unparseable or backwards pair is
 * dropped rather than counted as zero or negative time.
 */

/** One interval, as the wire carries it: two instants, start before end. */
export interface TimeInterval {
  readonly startedAt: string
  readonly endedAt: string
}

/** The arithmetic form of an interval: epoch milliseconds. */
export interface TimeSpan {
  readonly start: number
  readonly end: number
}

/** One union segment and which sources were active during it. */
export interface SourceSpan extends TimeSpan {
  readonly sources: readonly string[]
}

/**
 * Parse one interval into a span.
 *
 * @param interval - instants from the wire.
 * @returns the span, or undefined when either instant is unparseable or the
 * pair runs backwards. A backwards pair is dropped, not flipped: the two
 * instants mean what they say, and a wrong one is a fact to omit.
 */
export function spanOf(interval: TimeInterval): TimeSpan | undefined {
  const start = Date.parse(interval.startedAt)
  const end = Date.parse(interval.endedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined
  return { start, end }
}

/**
 * Merge overlapping and touching spans into the shortest covering list.
 *
 * Touching spans merge (`end === next.start`) because no gap separates them:
 * drawing them as two blocks would show a seam that is not there. The input is
 * not mutated.
 */
export function mergeSpans(spans: readonly TimeSpan[]): TimeSpan[] {
  const sorted = spans
    .filter(span => Number.isFinite(span.start) && Number.isFinite(span.end) && span.end > span.start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const merged: TimeSpan[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && span.start <= last.end) {
      if (span.end > last.end) merged[merged.length - 1] = { start: last.start, end: span.end }
    } else {
      merged.push({ start: span.start, end: span.end })
    }
  }
  return merged
}

/** Whole seconds covered by the union of these spans, rounded once. */
export function secondsOf(spans: readonly TimeSpan[]): number {
  const total = mergeSpans(spans).reduce((sum, span) => sum + (span.end - span.start), 0)
  return Math.round(total / 1000)
}

/** Whole seconds covered by the union of these intervals. */
export function unionSeconds(intervals: readonly TimeInterval[]): number {
  return secondsOf(intervals.map(spanOf).filter((span): span is TimeSpan => span !== undefined))
}

/**
 * Remove `holes` from `spans`, returning the kept pieces.
 *
 * This is the focus deduction the conversation attention uses: a two-minute
 * tail or a three-minute bridge is attention **unless** the user was in a focus
 * session during it, and a focus session is a hole in the conversation, not a
 * second kind of time. Both inputs are merged first, so the result is a minimal
 * list of pieces and no hole survives inside one.
 */
export function subtractSpans(spans: readonly TimeSpan[], holes: readonly TimeSpan[]): TimeSpan[] {
  const cutOut = mergeSpans(holes)
  const kept: TimeSpan[] = []
  for (const span of mergeSpans(spans)) {
    let cursor = span.start
    for (const hole of cutOut) {
      if (hole.end <= cursor) continue
      if (hole.start >= span.end) break
      const cut = Math.min(hole.start, span.end)
      if (cut > cursor) kept.push({ start: cursor, end: cut })
      cursor = Math.max(cursor, hole.end)
      if (cursor >= span.end) break
    }
    if (cursor < span.end) kept.push({ start: cursor, end: span.end })
  }
  return kept
}

/** The interval-shaped form of {@link subtractSpans}, for the wire. */
export function subtractIntervals(
  intervals: readonly TimeInterval[],
  holes: readonly TimeInterval[],
): TimeInterval[] {
  const spans = intervals.map(spanOf).filter((span): span is TimeSpan => span !== undefined)
  const cuts = holes.map(spanOf).filter((span): span is TimeSpan => span !== undefined)
  return subtractSpans(spans, cuts).map(span => ({
    startedAt: new Date(span.start).toISOString(),
    endedAt: new Date(span.end).toISOString(),
  }))
}

/**
 * Split the union of several named sources into segments that name the sources
 * active in each one.
 *
 * This is what the overview's merged row draws: each segment's width is real
 * wall-clock time, and its sub-bands say *which* of focus, conversation and
 * record were present — so an overlap adds a band, never a second width. A
 * source with no spans contributes no boundary and no band.
 *
 * Adjacent segments are not coalesced even when they carry the same sources:
 * a boundary exists because some source started or stopped there, and keeping
 * it makes the render independent of how the rows were ordered.
 */
export function splitBySource(
  sources: readonly { readonly source: string; readonly spans: readonly TimeSpan[] }[],
): SourceSpan[] {
  const points = [...new Set(sources.flatMap(entry => entry.spans.flatMap(span => [span.start, span.end])))]
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const segments: SourceSpan[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    if (start === undefined || end === undefined || end <= start) continue
    const active = sources
      .filter(entry => entry.spans.some(span => span.start < end && span.end > start))
      .map(entry => entry.source)
    if (active.length === 0) continue
    segments.push({ start, end, sources: active })
  }
  return segments
}
