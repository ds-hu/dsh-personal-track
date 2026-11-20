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
    today: '2026-09-16',
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

report()
