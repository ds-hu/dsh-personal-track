/**
 * The B model: conversation attention as one wall clock, from raw presence.
 *
 * This module is the **derivation**, deliberately separate from the store and
 * from the day view so the two thresholds and the patrol rule are testable
 * without a domain, a clock or a network:
 *
 * - a **prompt** opens a two-minute tail on its conversation — the user sent a
 *   command and is plausibly still with it;
 * - two visits to the same conversation less than three minutes apart are
 *   **bridged** — attention that briefly looked away;
 * - two **different** conversations less than three minutes apart produce a
 *   **patrol** gap — the user is moving between conversations, and the gap is
 *   still conversation time but belongs to no single one, so it is a row of its
 *   own rather than being split arbitrarily;
 * - a **focus session** is a hole: the user is focusing on a task, not talking.
 *
 * Every result is wall-clock time. Overlaps between sessions, between devices
 * and between a tail and a visit are unioned, never summed — that is the whole
 * anti-double-count rule. The per-session rows are attribution; the patrol is
 * the part that cannot be attributed; the total is their union.
 *
 * The constants are observation, not preference: two and three minutes are the
 * spec's numbers. A change is a version of the model, not a config field.
 */
import { mergeSpans, secondsOf, spanOf, subtractSpans, type TimeInterval, type TimeSpan } from '../shared/time-union.ts'

/** One observed conversation interval, from a client's in/out pair. */
export interface AttentionSegment {
  readonly sessionId: string
  readonly startedAt: string
  readonly endedAt: string
}

/** One user prompt, as an instant. */
export interface AttentionPrompt {
  readonly sessionId: string
  readonly at: string
}

/** One conversation's attributed attention. */
export interface AttentionWindow {
  readonly sessionId: string
  readonly intervals: readonly TimeInterval[]
  readonly seconds: number
}

/** The whole day's conversation attention. */
export interface Attention {
  /** Per-conversation rows; overlaps between them are possible and are not summed. */
  readonly sessions: readonly AttentionWindow[]
  /** Cross-conversation gaps under the bridge threshold, minus the attributed part. */
  readonly patrol: readonly TimeInterval[]
  /** The union of the session rows and the patrol. */
  readonly total: readonly TimeInterval[]
  readonly totalSeconds: number
}

/** A prompt's attention tail. */
export const ATTENTION_TAIL_MS = 2 * 60_000

/** The largest gap that still counts as attention between visits. */
export const ATTENTION_BRIDGE_MS = 3 * 60_000

/** Intersect spans with the day and merge them. */
function clamp(spans: readonly TimeSpan[], fromMs: number, toMs: number): TimeSpan[] {
  return mergeSpans(spans
    .map(span => ({ start: Math.max(span.start, fromMs), end: Math.min(span.end, toMs) }))
    .filter(span => span.end > span.start))
}

/** Turns the arithmetic form back into the wire's instants. */
function toIntervals(spans: readonly TimeSpan[]): TimeInterval[] {
  return spans.map(span => ({
    startedAt: new Date(span.start).toISOString(),
    endedAt: new Date(span.end).toISOString(),
  }))
}

/** Build the attention model for one habit day. */
export function buildAttention(input: {
  readonly segments: readonly AttentionSegment[]
  readonly prompts: readonly AttentionPrompt[]
  readonly focus: readonly TimeInterval[]
  readonly from: string
  readonly to: string
}): Attention {
  const fromMs = Date.parse(input.from)
  const toMs = Date.parse(input.to)

  // The presence union first: two devices in one conversation are one span.
  const bySession = new Map<string, TimeSpan[]>()
  for (const segment of input.segments) {
    const span = spanOf({ startedAt: segment.startedAt, endedAt: segment.endedAt })
    if (span === undefined) continue
    const list = bySession.get(segment.sessionId) ?? []
    list.push(span)
    bySession.set(segment.sessionId, list)
  }
  const presence = new Map<string, TimeSpan[]>()
  for (const [sessionId, spans] of bySession) presence.set(sessionId, clamp(spans, fromMs, toMs))

  // Same-conversation gaps under the bridge are attention too.
  const windows = new Map<string, TimeSpan[]>()
  for (const [sessionId, spans] of presence) {
    const bridged = [...spans]
    for (let index = 1; index < spans.length; index += 1) {
      const previous = spans[index - 1]
      const next = spans[index]
      if (previous === undefined || next === undefined) continue
      const gap = next.start - previous.end
      if (gap > 0 && gap < ATTENTION_BRIDGE_MS) bridged.push({ start: previous.end, end: next.start })
    }
    windows.set(sessionId, mergeSpans(bridged))
  }

  // Each prompt's tail belongs to its own conversation.
  for (const prompt of input.prompts) {
    const at = Date.parse(prompt.at)
    if (!Number.isFinite(at)) continue
    const tail = clamp([{ start: at, end: at + ATTENTION_TAIL_MS }], fromMs, toMs)
    if (tail.length === 0) continue
    const list = windows.get(prompt.sessionId) ?? []
    list.push(...tail)
    windows.set(prompt.sessionId, mergeSpans(list))
  }

  // Focus is a hole, not a second source.
  const focus = clamp(
    input.focus.map(spanOf).filter((span): span is TimeSpan => span !== undefined),
    fromMs,
    toMs,
  )
  const active = new Map<string, TimeSpan[]>()
  for (const [sessionId, spans] of windows) {
    const kept = subtractSpans(spans, focus)
    if (kept.length > 0) active.set(sessionId, kept)
  }
  const activeAll = mergeSpans([...active.values()].flat())

  // The cross-session gaps. The comparison point is the furthest end seen so
  // far, not the previous span's end: with overlapping visits (two foreground
  // devices in different conversations) the contained span would otherwise move
  // the point backwards and hide the real transition.
  const ordered = [...presence.entries()]
    .flatMap(([sessionId, spans]) => spans.map(span => ({ ...span, sessionId })))
    .sort((left, right) => left.start - right.start || left.end - right.end)
  const gaps: TimeSpan[] = []
  let reach: { end: number; sessionId: string } | null = null
  for (const span of ordered) {
    if (reach !== null && span.start > reach.end) {
      const gap = span.start - reach.end
      if (gap < ATTENTION_BRIDGE_MS && reach.sessionId !== span.sessionId) {
        gaps.push({ start: reach.end, end: span.start })
      }
    }
    if (reach === null || span.end > reach.end) reach = { end: span.end, sessionId: span.sessionId }
  }
  // The patrol is what remains after the attributed windows and focus are removed.
  const patrol = subtractSpans(subtractSpans(clamp(gaps, fromMs, toMs), activeAll), focus)
  const total = mergeSpans([...activeAll, ...patrol])

  const sessions: AttentionWindow[] = [...active.entries()]
    .map(([sessionId, spans]) => ({
      sessionId,
      intervals: toIntervals(spans),
      seconds: secondsOf(spans),
    }))
    .sort((left, right) => {
      const a = Date.parse(left.intervals[0]?.startedAt ?? '')
      const b = Date.parse(right.intervals[0]?.startedAt ?? '')
      return (Number.isFinite(a) ? a : Number.POSITIVE_INFINITY) - (Number.isFinite(b) ? b : Number.POSITIVE_INFINITY)
        || left.sessionId.localeCompare(right.sessionId)
    })

  return {
    sessions,
    patrol: toIntervals(patrol),
    total: toIntervals(total),
    totalSeconds: secondsOf(total),
  }
}
