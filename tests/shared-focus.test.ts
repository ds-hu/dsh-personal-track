/**
 * The shared focus-session rules, asserted directly.
 *
 * They used to be re-derived in five places — the store's open/close writes,
 * `derive.focusSeconds`, the statistics' range fold, the overlay's open-session
 * lookup, and the focus column's browser-local pin. These cases are the module's
 * own test surface: no store, no React, no DOM.
 *
 * Runs on Node's native type stripping:
 *   node tests/shared-focus.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker } from './support.ts'
import {
  focusSeconds,
  latestClosed,
  openSession,
  recentFocus,
  withClosedSession,
  withOpenedSession,
  type Session,
} from '../src/shared/focus-session.ts'

const { check, report } = createChecker('focus sessions: the rules both halves share')

const T0 = '2026-09-16T12:00:00.000Z'
const T10 = '2026-09-16T12:10:00.000Z'
const T20 = '2026-09-16T12:20:00.000Z'
const T30 = '2026-09-16T12:30:00.000Z'
const T40 = '2026-09-16T12:40:00.000Z'
const T50 = '2026-09-16T12:50:00.000Z'

/** One session: open when `endedAt` is omitted. */
function session(id: string, startedAt: string, endedAt?: string): Session {
  return endedAt === undefined ? { id, startedAt } : { id, startedAt, endedAt }
}

check('only closed sessions count, and a backwards pair counts zero', () => {
  assert.equal(
    focusSeconds([session('a', T0, T10), session('b', T10)]),
    600,
    'ten minutes from the closed one, nothing from the open one',
  )
  assert.equal(focusSeconds([session('c', T10, T0)]), 0, 'never negative time')
})

check('the open session is found, and an all-closed list has none', () => {
  const open = session('open', T20)
  assert.equal(openSession([session('a', T0, T10), open]), open)
  assert.equal(openSession([session('a', T0, T10)]), undefined)
  assert.equal(openSession([]), undefined)
})

check('latestClosed is the closed session that started last', () => {
  const older = session('a', '2026-09-16T09:00:00.000Z', '2026-09-16T09:30:00.000Z')
  const newer = session('b', '2026-09-16T11:00:00.000Z', '2026-09-16T11:20:00.000Z')
  // Out of order on purpose: the rule is the start instant, not the slot.
  assert.equal(latestClosed([newer, older]), newer)
  assert.equal(latestClosed([older, session('open', '2026-09-17T09:00:00.000Z')]), older, 'an open one is not a fact yet')
  assert.equal(latestClosed([]), undefined)
})

check('opening a session drops one a crash left open', () => {
  const closed = session('a', T0, T10)
  const abandoned = session('b', T20)
  const fresh = session('c', T30)
  assert.deepEqual(
    withOpenedSession([closed, abandoned], fresh),
    [closed, fresh],
    'the abandoned session is gone, not closed at a guess',
  )
  assert.deepEqual(withOpenedSession([], fresh), [fresh])
})

check('closing stamps the open one and leaves every other id alone', () => {
  const closed = session('a', T0, T10)
  const open = session('b', T20)
  assert.deepEqual(
    withClosedSession([closed, open], 'b', T30),
    [closed, session('b', T20, T30)],
  )
  assert.deepEqual(withClosedSession([closed, open], 'nope', T30), [closed, open], 'an unknown id is a no-op')
  assert.deepEqual(withClosedSession([closed], 'a', T30), [closed], 'and the first stamp stands')
})

check('recentFocus takes the newest closed session across both registries', () => {
  const task = { id: 't1', focusSessions: [session('a', T0, T10)] }
  const media = { id: 'm1', focusSessions: [session('b', T20, T40), session('open', T50)] }
  const recent = recentFocus([task, media])
  assert.equal(recent?.entry, media, 'the entry comes back by reference, so its own type survives')
  assert.equal(recent?.session.id, 'b', 'and the open session is not the most recent one')
  assert.equal(recentFocus([{ id: 'x', focusSessions: [] }]), undefined, 'no closed session, no card')
  assert.equal(recentFocus([]), undefined)
})

check('a deleted entry takes its session with it, and the answer falls to the next one', () => {
  const older = { id: 't1', focusSessions: [session('a', T0, T10)] }
  const newer = { id: 'm1', focusSessions: [session('b', T20, T40)] }
  assert.equal(recentFocus([newer, older])?.entry, newer)
  assert.equal(recentFocus([older])?.entry, older, 'hard delete leaves nothing to dangle')
})

report()
