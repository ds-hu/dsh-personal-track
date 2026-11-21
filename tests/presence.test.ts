/**
 * Conversation attention: the B model over raw presence.
 *
 * The store tests prove the observations (an out closes at the host's receive
 * time, a sweep at the lastSeen, a checkpoint survives a restart). The pure
 * tests pin the two thresholds and the two anti-double-count rules: a
 * conversation's own visits and tail are unioned, and a cross-conversation gap
 * is the patrol row rather than a split between the two conversations.
 *
 * Runs on Node's native type stripping:
 *   node tests/presence.test.ts
 */
import { strict as assert } from 'node:assert'
import { boundaryOf } from '../src/host/config.ts'
import { buildAttention } from '../src/host/attention.ts'
import { createPresence } from '../src/host/presence.ts'
import { buildTime } from '../src/host/time.ts'
import type { PresenceDay } from '../src/host/domain.ts'
import { habitDayKey, shiftDayKey } from '../src/shared/habit-day.ts'
import { unionSeconds } from '../src/shared/time-union.ts'
import { createChecker, createHarness, memoryDomain } from './support.ts'

const checker = createChecker('conversation attention: raw presence in, B model out')
const { check, checkAsync, report } = checker

const DATE = '2026-11-19'
/** A wall time on the fixture day, in the boundary's +08:00 zone. */
const AT = (clock: string): string => `2026-11-19T${clock}+08:00`
/** The habit day's first and last instants, in UTC. */
const FROM = '2026-11-18T20:00:00.000Z'
const TO = '2026-11-19T20:00:00.000Z'
const secs = (count: number): number => count * 60

const boundary = boundaryOf({
  dayStartHour: 4,
  defaultVocabTarget: { new: 20, review: 60 },
  defaultRunMinutes: 30,
})

// --- the store: observations, not durations ---------------------------------

await checkAsync('a closed presence segment is stored raw and read back', async () => {
  const domain = memoryDomain()
  let clock = new Date(AT('09:00'))
  const presence = createPresence({ domain, boundary, now: () => clock })
  await presence.in('s1', 'c1', 'k1')
  clock = new Date(AT('09:10'))
  await presence.out('s1', 'c1', 'k1')

  const read = await presence.readDay(DATE)
  assert.equal(read.segments.length, 1)
  assert.equal(read.segments[0]?.sessionId, 's1')
  assert.equal(Date.parse(read.segments[0]!.startedAt), Date.parse(AT('09:00')))
  assert.equal(Date.parse(read.segments[0]!.endedAt), Date.parse(AT('09:10')))

  const doc = domain.table('presence').get(DATE)
  assert.deepEqual(doc?.events.map(event => event.state), ['in', 'out'], 'the raw pair, not a duration')
})

await checkAsync('a sweep closes a silent session at its lastSeen, not at the sweep', async () => {
  const domain = memoryDomain()
  let clock = new Date(AT('09:00'))
  const presence = createPresence({ domain, boundary, now: () => clock })
  await presence.in('s1', 'c1', 'k1')
  clock = new Date(AT('09:00:20'))
  await presence.beat('s1', 'c1', 'k1')
  clock = new Date(AT('09:02'))
  await presence.sweep()

  const read = await presence.readDay(DATE)
  assert.equal(read.segments[0]?.endedAt, new Date(AT('09:00:20')).toISOString())
})

await checkAsync('a checkpoint writes the observed prefix, so a restart keeps the segment', async () => {
  const domain = memoryDomain()
  let clock = new Date(AT('09:00'))
  const presence = createPresence({ domain, boundary, now: () => clock })
  await presence.in('s1', 'c1', 'k1')
  clock = new Date(AT('09:03'))
  await presence.beat('s1', 'c1', 'k1')
  await presence.checkpoint()

  // A new store over the same domain is what a host restart looks like.
  const restarted = createPresence({ domain, boundary, now: () => new Date(AT('10:00')) })
  const read = await restarted.readDay(DATE)
  assert.equal(read.segments.length, 1)
  assert.equal(Date.parse(read.segments[0]!.endedAt), Date.parse(AT('09:03')), 'the checkpoint is the observed end')
})

await checkAsync('a host restart opens a new segment, and the downtime is a gap rather than attention', async () => {
  const domain = memoryDomain()
  let clock = new Date(AT('09:00'))
  const presence = createPresence({ domain, boundary, now: () => clock })
  await presence.in('s1', 'c1', 'k1')
  clock = new Date(AT('09:03'))
  await presence.beat('s1', 'c1', 'k1')
  await presence.checkpoint()

  // The host comes back at 10:00; the tab's next beat is the first thing it sees.
  const restarted = createPresence({ domain, boundary, now: () => new Date(AT('10:00')) })
  await restarted.beat('s1', 'c1', 'k1')

  const read = await restarted.readDay(DATE)
  assert.equal(read.segments.length, 2, 'the old and the resumed segments are separate')
  assert.equal(Date.parse(read.segments[0]!.endedAt), Date.parse(AT('09:03')), 'the old one ends at its last observation')
  assert.equal(Date.parse(read.segments[1]!.startedAt), Date.parse(AT('10:00')), 'the new one starts at the resumed beat')

  const result = attention({ segments: read.segments })
  assert.equal(result.totalSeconds, secs(3), 'the 57-minute downtime is not conversation time')
})

await checkAsync('close flushes the live prefix before the domain goes away', async () => {
  const domain = memoryDomain()
  let clock = new Date(AT('09:00'))
  const presence = createPresence({ domain, boundary, now: () => clock })
  await presence.in('s1', 'c1', 'k1')
  clock = new Date(AT('09:03'))
  await presence.beat('s1', 'c1', 'k1')
  await presence.close()

  // The domain is still readable here; in production the owner closes it only
  // after this flush resolves.
  const read = await createPresence({ domain, boundary, now: () => clock }).readDay(DATE)
  assert.equal(read.segments.length, 1)
  assert.equal(Date.parse(read.segments[0]!.endedAt), Date.parse(AT('09:03')), 'the flush is what survives a shutdown')
})

// --- the two thresholds ------------------------------------------------------

/** The pure model over the fixture day. */
function attention(input: {
  readonly segments?: readonly { sessionId: string; startedAt: string; endedAt: string }[]
  readonly prompts?: readonly { sessionId: string; at: string }[]
  readonly focus?: readonly { startedAt: string; endedAt: string }[]
}) {
  return buildAttention({
    segments: input.segments ?? [],
    prompts: input.prompts ?? [],
    focus: input.focus ?? [],
    from: FROM,
    to: TO,
  })
}

check('a prompt opens a two-minute tail on its own conversation', () => {
  const result = attention({
    segments: [{ sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:10') }],
    prompts: [{ sessionId: 's1', at: AT('09:10') }],
  })
  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0]?.seconds, secs(12), 'ten minutes present plus the two-minute tail')
  assert.equal(result.totalSeconds, secs(12))
})

check('a prompt without a presence segment is still conversation attention', () => {
  const result = attention({ prompts: [{ sessionId: 's1', at: AT('09:00') }] })
  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0]?.seconds, secs(2))
})

check('two visits under three minutes are bridged; exactly three are not', () => {
  const bridged = attention({
    segments: [
      { sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:10') },
      { sessionId: 's1', startedAt: AT('09:12'), endedAt: AT('09:20') },
    ],
  })
  assert.equal(bridged.sessions[0]?.seconds, secs(20), 'the 09:10–09:12 gap belongs to the same conversation')
  assert.equal(bridged.patrol.length, 0)

  const exactly = attention({
    segments: [
      { sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:10') },
      { sessionId: 's1', startedAt: AT('09:13'), endedAt: AT('09:20') },
    ],
  })
  assert.equal(exactly.sessions[0]?.seconds, secs(17), 'exactly three minutes is not "less than three"')
})

check('a cross-conversation gap under three minutes is the patrol row, not a split', () => {
  const result = attention({
    segments: [
      { sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:10') },
      { sessionId: 's2', startedAt: AT('09:12'), endedAt: AT('09:20') },
    ],
  })
  assert.equal(result.sessions.length, 2)
  assert.equal(unionSeconds(result.patrol), secs(2))
  assert.equal(result.totalSeconds, secs(20), 'the patrol is inside the total, not on top of it')
  assert.equal(
    result.sessions.reduce((sum, row) => sum + row.seconds, 0),
    secs(18),
    'the session rows are attribution and do not include the patrol',
  )

  const exactly = attention({
    segments: [
      { sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:10') },
      { sessionId: 's2', startedAt: AT('09:13'), endedAt: AT('09:20') },
    ],
  })
  assert.equal(exactly.patrol.length, 0, 'exactly three minutes is not a patrol')
  assert.equal(exactly.totalSeconds, secs(17))
})

check('an overlapping visit does not hide the patrol gap after it', () => {
  const result = attention({
    segments: [
      { sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:10') },
      { sessionId: 's2', startedAt: AT('09:05'), endedAt: AT('09:06') },
      { sessionId: 's3', startedAt: AT('09:12'), endedAt: AT('09:20') },
    ],
  })
  assert.equal(unionSeconds(result.patrol), secs(2), 'the contained visit must not move the reach backwards')
  assert.equal(result.totalSeconds, secs(20))
})

check('a focus session is a hole in the conversation', () => {
  const result = attention({
    segments: [{ sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:10') }],
    focus: [{ startedAt: AT('09:03'), endedAt: AT('09:05') }],
  })
  assert.equal(result.sessions[0]?.seconds, secs(8))
  assert.equal(result.totalSeconds, secs(8))
})

check('two devices in one conversation overlap, so they are unioned not summed', () => {
  const result = attention({
    segments: [
      { sessionId: 's1', startedAt: AT('09:00'), endedAt: AT('09:15') },
      { sessionId: 's1', startedAt: AT('09:05'), endedAt: AT('09:20') },
    ],
  })
  assert.equal(result.sessions.length, 1)
  assert.equal(result.sessions[0]?.seconds, secs(20))
  assert.equal(result.totalSeconds, secs(20))
})

check('a tail that crosses the habit-day end is clipped, not carried into the next day', () => {
  const result = buildAttention({
    segments: [],
    prompts: [{ sessionId: 's1', at: '2026-11-19T19:59:00.000Z' }],
    focus: [],
    from: FROM,
    to: TO,
  })
  assert.equal(result.totalSeconds, secs(1))
})

// --- the day view joins the rows ---------------------------------------------

await checkAsync('the time view names each conversation and keeps the patrol as its own row', async () => {
  const api = createHarness()
  const view = buildTime({
    store: api.store,
    date: '2026-09-16',
    boundary: boundaryOf(api.config),
    presence: {
      segments: [
        { sessionId: 's1', startedAt: '2026-09-16T01:00:00.000Z', endedAt: '2026-09-16T01:10:00.000Z' },
        { sessionId: 's2', startedAt: '2026-09-16T01:12:00.000Z', endedAt: '2026-09-16T01:20:00.000Z' },
      ],
      prompts: [],
    },
    now: new Date('2026-09-16T12:00:00.000Z'),
  })

  assert.deepEqual(view.talk.map(row => row.id), ['s1', 's2', 'patrol'], 'sessions ascending, the patrol last')
  assert.equal(view.totals.talk, secs(20))
  assert.equal(view.talk.find(row => row.id === 'patrol')?.seconds, secs(2))
  assert.equal(view.totals.covered, secs(20), 'no records, so the union is the talk total')
})

// --- the raw window: three days, then the ledger -----------------------------

/** One raw `in`/`out` pair on `day`, at `clock` local time. */
function rawDayOf(day: string, clock: string): PresenceDay {
  const at = (time: string): string => `${day}T${time}+08:00`
  return {
    date: day,
    events: [
      { id: `${day}-in`, kind: 'presence', state: 'in', sessionId: 's1', clientId: 'c1', connectionId: 'k1', at: at(clock) },
      { id: `${day}-out`, kind: 'presence', state: 'out', sessionId: 's1', clientId: 'c1', connectionId: 'k1', at: at('09:10') },
    ],
  }
}

await checkAsync('the window keeps three days of raw events and folds the fourth', async () => {
  const domain = memoryDomain()
  const today = habitDayKey(new Date(AT('09:00')), boundary)
  const presence = createPresence({ domain, boundary, now: () => new Date(AT('12:00')) })
  for (const daysAgo of [0, 1, 2, 3]) {
    const day = shiftDayKey(today, -daysAgo)
    await domain.table('presence').put(day, rawDayOf(day, '09:00'))
  }

  await presence.maintain()

  assert.deepEqual(
    [...domain.table('presence').keys()].sort(),
    [today, shiftDayKey(today, -1), shiftDayKey(today, -2)].sort(),
    'today and the two before it keep their raw events',
  )
  const folded = domain.table('time').get(shiftDayKey(today, -3))
  assert.deepEqual(folded?.items.map(item => item.kind), ['talk'], 'the fourth day became a visit')
})

await checkAsync('a folded day reads back the same visits and prompts', async () => {
  const domain = memoryDomain()
  const old = shiftDayKey(habitDayKey(new Date(AT('09:00')), boundary), -4)
  await domain.table('presence').put(old, {
    date: old,
    events: [
      ...rawDayOf(old, '09:00').events,
      { id: `${old}-prompt`, kind: 'prompt', sessionId: 's1', clientId: 'c1', connectionId: 'k1', at: `${old}T09:05+08:00` },
    ],
  })
  const presence = createPresence({ domain, boundary, now: () => new Date(AT('12:00')) })
  const before = await presence.readDay(old)
  assert.equal(before.segments.length, 1, 'the raw pair folds into one visit')

  await presence.maintain()
  assert.equal(domain.table('presence').get(old), undefined, 'the raw events are gone')

  const after = await presence.readDay(old)
  assert.deepEqual(after.segments, before.segments, 'the same visit, read from the ledger')
  assert.deepEqual(after.prompts, before.prompts, 'and the same prompt')
  // The attention model consumes these two lists and nothing else, so a day
  // that reads back identical draws an identical band.
  const band = (read: typeof before): number => buildAttention({
    segments: read.segments, prompts: read.prompts, focus: [], from: `${old}T04:00+08:00`, to: `${shiftDayKey(old, 1)}T04:00+08:00`,
  }).totalSeconds
  assert.equal(band(after), band(before))

  await presence.maintain()
  assert.equal(domain.table('time').get(old)?.items.length, 2, 'a second pass adds nothing')
})

await checkAsync('a day a still-running visit started on is never folded away', async () => {
  const domain = memoryDomain()
  const start = new Date(AT('09:00'))
  let clock = start
  const presence = createPresence({ domain, boundary, now: () => clock })
  await presence.in('s1', 'c1', 'k1')
  const day = habitDayKey(start, boundary)

  // Three more days of one unbroken visit — a kiosk tab, say. Its beats land in
  // the document of the day the session *started* in, which by now is older
  // than the raw window and therefore a compaction candidate.
  for (const offset of [1, 2, 3]) {
    clock = new Date(start.getTime() + offset * 86_400_000)
    await presence.beat('s1', 'c1', 'k1')
    await presence.checkpoint()
  }

  await presence.maintain()
  assert.ok(domain.table('presence').get(day), 'the anchor stays while the visit is running')
  assert.equal(domain.table('time').get(day), undefined, 'and the day is not folded yet')

  // It ends three hours after that last beat: now the day can fold, and the row
  // has to cover the whole visit, not the prefix compaction happened to see.
  clock = new Date(start.getTime() + 3 * 86_400_000 + 3 * 3_600_000)
  await presence.out('s1', 'c1', 'k1')
  await presence.maintain()
  const read = await presence.readDay(day)
  assert.equal(read.segments.length, 1)
  assert.equal(Date.parse(read.segments[0]!.startedAt), start.getTime())
  assert.equal(Date.parse(read.segments[0]!.endedAt), clock.getTime(), 'the tail after the window is not lost')
  assert.equal(domain.table('presence').get(day), undefined, 'and the raw events are gone now')
})

report()
