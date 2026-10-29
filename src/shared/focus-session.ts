/**
 * Focus sessions: **the one copy** of what a **专注会话** means.
 *
 * A session is the fact that someone sat down with one registry entry, from one
 * instant to another. Duration is never stored — it is `endedAt − startedAt`,
 * derived on read like every other derived value
 * (docs/adr/0002-derived-state-not-stored.md). What is stated here, once, is
 * everything the two halves must agree on:
 *
 * - only a **closed** session counts — an open one has no honest end;
 * - a session a crash left open is **dropped**, not closed at a guessed instant;
 * - an entry has at most one open session, so opening one discards the other;
 * - closing is idempotent: an unknown or already-closed id changes nothing;
 * - **最近专注** is the closed session with the latest start, across both
 *   registries — a derived fact, so no surface has to remember one.
 *
 * This lives under `src/shared` because both programs need it: the host opens
 * and closes sessions and folds them into statistics, while the browser renders
 * the focus column and the session in progress. It is isomorphic on purpose —
 * `Date` only, no `node:` imports, no DOM — so the browser bundle can inline it.
 */

/** One focus session, structurally: the shape both halves already carry. */
export interface Session {
  readonly id: string
  readonly startedAt: string
  /** Absent only while the session is open. */
  readonly endedAt?: string
}

/**
 * Seconds spent focusing, summed over **closed** sessions.
 *
 * An open session has no end, and no instant the *host* could pick for one —
 * "now", or the moment of the last write — is the moment the user actually
 * stopped, so it is dropped instead (the next `startFocus` clears it away)
 * rather than closed at a guess. The one end the client can honestly report is
 * the page going away, and it does (`pagehide` in `FocusOverlay`): a refresh is
 * a real end. A crash fires no such event, and that session is the one this
 * rule drops. A backwards pair counts zero rather than negative time.
 */
export function focusSeconds(
  sessions: readonly { readonly startedAt: string; readonly endedAt?: string }[],
): number {
  let total = 0
  for (const session of sessions) {
    if (session.endedAt === undefined) continue
    const span = Date.parse(session.endedAt) - Date.parse(session.startedAt)
    if (Number.isFinite(span) && span > 0) total += span / 1000
  }
  return Math.round(total)
}

/** The session still running, if any. Normally there is at most one. */
export function openSession(sessions: readonly Session[]): Session | undefined {
  return sessions.find(session => session.endedAt === undefined)
}

/**
 * The closed session that started last — the fact **最近专注** is derived from.
 *
 * Open sessions are skipped for the same reason they count no time: until one
 * is closed there is no honest answer to "how long was that". An unparseable
 * start is skipped too, because it cannot be ordered; ties keep the first one
 * seen, so the answer is stable rather than dependent on an unstable sort.
 */
export function latestClosed(sessions: readonly Session[]): Session | undefined {
  let latest: Session | undefined
  let latestAt = Number.NEGATIVE_INFINITY
  for (const session of sessions) {
    if (session.endedAt === undefined) continue
    const at = Date.parse(session.startedAt)
    if (!Number.isFinite(at) || at <= latestAt) continue
    latest = session
    latestAt = at
  }
  return latest
}

/**
 * Open a session: append it, and **drop** any session still open.
 *
 * Dropped rather than closed at a guessed instant — a crash fires no event, so
 * the end of that session is unknowable and inventing one would be inventing a
 * fact. Appending keeps the array in the order the sessions happened.
 */
export function withOpenedSession(sessions: readonly Session[], session: Session): Session[] {
  return [...sessions.filter(open => open.endedAt !== undefined), session]
}

/**
 * Close one session by id.
 *
 * A no-op for an id that is unknown or already closed: a second window may have
 * finished it already, and a second click is not a fault. The first stamp stands.
 */
export function withClosedSession(
  sessions: readonly Session[],
  sessionId: string,
  endedAt: string,
): Session[] {
  return sessions.map(session =>
    session.id === sessionId && session.endedAt === undefined ? { ...session, endedAt } : session)
}

/**
 * What the focus column is showing: the entry whose closed session started last,
 * over **both** registries.
 *
 * The entry comes back by reference, so a caller keeps its own type (a task
 * entry stays a task entry). Open sessions are ignored, as everywhere else; an
 * entry with no closed session is not a candidate. Nothing is stored for this —
 * delete the entry and its sessions go with it (registry entries are hard
 * deletions), so the answer simply falls to the next most recent one instead of
 * dangling.
 */
export function recentFocus<T extends { readonly focusSessions: readonly Session[] }>(
  entries: readonly T[],
): { readonly entry: T; readonly session: Session } | undefined {
  let best: { readonly entry: T; readonly session: Session } | undefined
  let bestAt = Number.NEGATIVE_INFINITY
  for (const entry of entries) {
    const session = latestClosed(entry.focusSessions)
    if (session === undefined) continue
    const at = Date.parse(session.startedAt)
    if (!Number.isFinite(at) || at <= bestAt) continue
    best = { entry, session }
    bestAt = at
  }
  return best
}
