/**
 * Range statistics: `buildStats`, against an in-memory domain.
 *
 * This is the most intricate module in the plugin (356 lines of aggregation)
 * and it had no unit test: the only coverage was a single real HTTP call in
 * scripts/verify-host.mjs. Driving it through the store means a range can be
 * built one day at a time and every figure inspected on its own terms.
 *
 * Runs on Node's native type stripping:
 *   node tests/stats.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker, createHarness } from './support.ts'
import { buildStats } from '../src/host/stats.ts'
import { boundaryOf } from '../src/host/config.ts'

const checker = createChecker('range statistics')
const { check, checkAsync, report } = checker

/** A Sunday-to-Saturday week to spread records over. */
const MON = '2026-09-14'
const TUE = '2026-09-15'
const WED = '2026-09-16'
const THU = '2026-09-17'

await checkAsync('an empty range reports zeros rather than throwing', async () => {
  const api = createHarness()
  const stats = buildStats(api.store, MON, WED, boundaryOf(api.config))
  assert.equal(stats.days.length, 3)
  assert.deepEqual(stats.days.map(day => day.stored), [false, false, false])
  assert.deepEqual(stats.days.map(day => day.done), [0, 0, 0])
  assert.equal(stats.perfectDays, 0)
  assert.equal(stats.habits.length, 8, 'the eight habits are always reported')
  for (const habit of stats.habits) {
    assert.equal(habit.met, 0)
    assert.equal(habit.days, 3)
    assert.equal(habit.ratio, 0)
    assert.equal(habit.streak, 0)
    assert.deepEqual(habit.perDay, [false, false, false], `${habit.id} must align with the day list`)
  }
  assert.deepEqual(stats.vocab, { new: 0, review: 0, minutes: 0, daysMet: 0, surplus: 0 })
  assert.deepEqual(stats.duolingo, { lessons: 0, minutes: 0, daysMet: 0 })
  assert.deepEqual(stats.runs, { count: 0, km: 0, points: [] })
  assert.deepEqual(stats.rope, { sets: 0, sets90: 0, sets180: 0, seconds: 0 })
  assert.deepEqual(stats.pullup, { sets: 0, seconds: 0 })
  assert.deepEqual(stats.plank, { sets: 0, seconds: 0 })
  assert.deepEqual(stats.equipment, { sets: 0, reps: 0, byName: [] })
  assert.deepEqual(stats.free, { sessions: 0, minutes: 0, kcal: 0, kcalSessions: 0 })
  assert.deepEqual(stats.washing, { count: 0, pieces: 0 })
  assert.deepEqual(stats.meals, { breakfast: { days: 0, ratio: 0 }, spend: 0 })
  assert.equal(stats.media.finished, 0)
  assert.equal(stats.media.avgRating, undefined)
  assert.equal(stats.tasks.open, 0)
})

await checkAsync('an average is omitted rather than reported as zero when nothing qualified', async () => {
  const api = createHarness()
  await api.store.mutateDay(WED, day => ({ ...day, run: { at: 'x', minutes: 30, distanceKm: 5 } }))
  const stats = buildStats(api.store, WED, WED, boundaryOf(api.config))
  assert.equal(stats.runs.count, 1)
  assert.equal(stats.runs.avgHr, undefined, 'no heart rate recorded, so there is no average')
  assert.deepEqual(stats.runs.points, [], 'and no curve point without one')
})

await checkAsync('per-day completion, perfect days and stored flags', async () => {
  const api = createHarness()
  // A perfect day needs all nine cells, training included.
  await api.store.mutateDay(WED, day => ({
    ...day,
    washes: { times: ['a', 'b'] },
    shower: { at: 'x' },
    meals: { breakfast: { at: 'x' }, lunch: { at: 'x' }, dinner: { at: 'x' } },
    vocab: { target: { new: 1, review: 0 }, sessions: [{ id: 'v', at: 'x', new: 1, review: 0, minutes: 5 }] },
    duolingo: [{ id: 'd', at: 'x', minutes: 5 }],
    rope: [{ id: 'r', at: 'x', preset: 90, seconds: 40 }],
  }))
  // A partly done day.
  await api.store.mutateDay(THU, day => ({ ...day, washes: { times: ['a'] } }))

  const stats = buildStats(api.store, WED, THU, boundaryOf(api.config))
  assert.deepEqual(stats.days.map(day => [day.date, day.stored]), [[WED, true], [THU, true]])
  assert.deepEqual(stats.days.map(day => day.done), [9, 1])
  assert.deepEqual(stats.days.map(day => day.total), [9, 9])
  assert.equal(stats.perfectDays, 1)
})

await checkAsync('training fills one 健身 cell and free sessions are aggregated apart', async () => {
  const api = createHarness()
  await api.store.addSession(WED, 'free', { at: 'x', minutes: 45, kcal: 400 })
  // A second session, deliberately unmeasured: the burn sum must not treat a
  // missing reading as zero burn.
  await api.store.addSession(THU, 'free', { at: 'x', minutes: 30 })
  await api.store.addSession(THU, 'plank', { at: 'x', seconds: 60 })

  const stats = buildStats(api.store, WED, THU, boundaryOf(api.config))
  const sport = stats.habits.find(habit => habit.id === 'sport')!
  assert.equal(sport.label, '健身')
  assert.deepEqual(sport.perDay, [true, true], 'a free session trains the day as a set does')
  assert.equal(sport.met, 2)
  assert.deepEqual(stats.free, { sessions: 2, minutes: 75, kcal: 400, kcalSessions: 1 })
  // Two training records on Thursday are one trained day, so one cell: 健身
  // answers "did I train", and a run plus a set is not two halves of a day.
  assert.deepEqual(stats.days.map(day => day.done), [1, 1])
})

await checkAsync('vocabulary is summed and the surplus is reported separately', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({
    ...day,
    vocab: {
      target: { new: 10, review: 10 },
      sessions: [
        { id: 'v1', at: 'x', new: 6, review: 4, minutes: 20 },
        { id: 'v2', at: 'y', new: 6, review: 20, minutes: 25 },
      ],
    },
  }))
  const stats = buildStats(api.store, MON, MON, boundaryOf(api.config))
  assert.deepEqual(stats.vocab, {
    new: 12,
    review: 24,
    minutes: 45,
    daysMet: 1,
    surplus: 2 + 14,
  })
})

await checkAsync('a day without a vocabulary block still counts toward the range length', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({
    ...day,
    vocab: { target: { new: 0, review: 0 }, sessions: [{ id: 'v', at: 'x', new: 1, review: 0, minutes: 5 }] },
  }))
  const stats = buildStats(api.store, MON, TUE, boundaryOf(api.config))
  const vocab = stats.habits.find(habit => habit.id === 'vocab')!
  assert.equal(vocab.met, 1)
  assert.deepEqual(vocab.perDay, [true, false])
  assert.equal(vocab.days, 2, 'a day absent from the medium is still a day in the range')
})

await checkAsync('a streak runs back from the end of the range, not the start', async () => {
  const api = createHarness()
  for (const key of [MON, TUE, WED]) {
    await api.store.mutateDay(key, day => ({ ...day, shower: { at: 'x' } }))
  }
  const stats = buildStats(api.store, MON, WED, boundaryOf(api.config))
  const shower = stats.habits.find(habit => habit.id === 'shower')!
  assert.equal(shower.streak, 3)
  assert.equal(shower.met, 3)
  // The same records seen through a range that stops a day earlier.
  const shorter = buildStats(api.store, MON, TUE, boundaryOf(api.config))
  assert.equal(shorter.habits.find(habit => habit.id === 'shower')!.streak, 2)
})

await checkAsync('washing up counts once against its two-a-day goal', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({ ...day, washes: { times: ['a'] } }))
  await api.store.mutateDay(TUE, day => ({ ...day, washes: { times: ['a', 'b'] } }))
  const stats = buildStats(api.store, MON, TUE, boundaryOf(api.config))
  const wash = stats.habits.find(habit => habit.id === 'wash')!
  assert.deepEqual(wash.perDay, [false, true], 'one wash is not the habit; two are')
  assert.equal(wash.met, 1)
  assert.equal(wash.ratio, 0.5)
})

await checkAsync('training sums split by preset, load and heart rate', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({
    ...day,
    run: { at: 'x', minutes: 30, distanceKm: 5, avgHr: 150 },
    rope: [
      { id: 'r1', at: 'x', preset: 90, seconds: 45, avgHr: 120 },
      { id: 'r2', at: 'x', preset: 180, seconds: 95, avgHr: 140 },
    ],
    pullup: [{ id: 'p1', at: 'x', seconds: 30 }, { id: 'p2', at: 'x', seconds: 20 }],
    plank: [{ id: 'k1', at: 'x', seconds: 60 }, { id: 'k2', at: 'x', seconds: 45 }],
    equipment: [
      { id: 'e1', at: 'x', name: '划船机', reps: 10 },
      { id: 'e2', at: 'x', name: '划船机', reps: 15 },
      { id: 'e3', at: 'x', name: '卧推', reps: 30 },
      { id: 'e4', at: 'x', name: '卧推', reps: 8, weight: 40 },
      { id: 'e5', at: 'x', name: '卧推', reps: 6, weight: 50 },
    ],
  }))
  const stats = buildStats(api.store, MON, MON, boundaryOf(api.config))
  assert.equal(stats.runs.count, 1)
  assert.equal(stats.runs.km, 5)
  assert.equal(stats.runs.avgHr, 150)
  assert.deepEqual(stats.runs.points, [{ date: MON, pace: 6, avgHr: 150, km: 5, minutes: 30 }])
  assert.deepEqual(stats.rope, { sets: 2, sets90: 1, sets180: 1, seconds: 140, avgHr: 130 })
  assert.deepEqual(stats.pullup, { sets: 2, seconds: 50 })
  assert.deepEqual(stats.plank, { sets: 2, seconds: 105 })
  assert.equal(stats.equipment.sets, 5)
  assert.equal(stats.equipment.reps, 69)
  assert.deepEqual(stats.equipment.byName, [
    { name: '划船机', sets: 2, reps: 25 },
    { name: '卧推', sets: 1, reps: 30 },
    { name: '卧推', weight: 40, sets: 1, reps: 8 },
    { name: '卧推', weight: 50, sets: 1, reps: 6 },
  ].sort((a, b) => b.reps - a.reps), 'one machine at another weight is its own entry, never merged')
})

await checkAsync('the pace curve keeps one point per qualifying run, in range order', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({ ...day, run: { at: 'x', minutes: 30, distanceKm: 5, avgHr: 140 } }))
  await api.store.mutateDay(WED, day => ({ ...day, run: { at: 'x', minutes: 26, distanceKm: 5, avgHr: 152 } }))
  const stats = buildStats(api.store, MON, WED, boundaryOf(api.config))
  assert.deepEqual(stats.runs.points.map(point => [point.date, point.pace]), [[MON, 6], [WED, 5.2]])
})

await checkAsync('the meal projection carries breakfast alone but spends across all three', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({
    ...day,
    meals: {
      breakfast: { at: 'x', price: 6 },
      lunch: { at: 'x', price: 12.5 },
      dinner: { at: 'x', price: 15 },
    },
  }))
  await api.store.mutateDay(TUE, day => ({ ...day, meals: { lunch: { at: 'x' } } }))
  const stats = buildStats(api.store, MON, TUE, boundaryOf(api.config))
  assert.equal(stats.meals.breakfast.days, 1)
  assert.equal(stats.meals.breakfast.ratio, 0.5)
  assert.equal(stats.meals.spend, 33.5)
})

await checkAsync('washing sessions sum their pieces', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({ ...day, washing: [{ id: 'w1', at: 'x', pieces: 4 }] }))
  await api.store.mutateDay(TUE, day => ({ ...day, washing: [{ id: 'w2', at: 'x', pieces: 6 }] }))
  const stats = buildStats(api.store, MON, TUE, boundaryOf(api.config))
  assert.deepEqual(stats.washing, { count: 2, pieces: 10 })
})

// --- the registries ----------------------------------------------------------

await checkAsync('media counts split by range and by current state', async () => {
  const api = createHarness()
  // Instants are written *without* a zone so they parse as local time, which is
  // the zone the habit day is derived in; a `Z` would push an evening record
  // onto the next habit day on a non-UTC machine.
  await api.store.putMedia({
    id: 'm1', kind: 'film', title: '在范围内', status: 'done', rating: 4,
    finishedAt: `${WED}T20:00:00`, createdAt: 'c',
  } as never)
  await api.store.putMedia({
    id: 'm2', kind: 'book', title: '范围外', status: 'done', rating: 2,
    finishedAt: `${MON}T20:00:00`, createdAt: 'c',
  } as never)
  await api.store.putMedia({ id: 'm3', kind: 'book', title: '在读', status: 'active', createdAt: 'c' } as never)
  await api.store.putMedia({ id: 'm4', kind: 'film', title: '弃了', status: 'dropped', createdAt: 'c' } as never)

  const stats = buildStats(api.store, WED, WED, boundaryOf(api.config))
  assert.equal(stats.media.finished, 1, 'only the one finished inside the range')
  assert.equal(stats.media.films, 2, 'current totals ignore the range')
  assert.equal(stats.media.books, 2)
  assert.equal(stats.media.active, 1)
  assert.equal(stats.media.dropped, 1)
  assert.equal(stats.media.avgRating, 3, 'the mean of the two ratings that exist')
  assert.equal(stats.media.recently.length, 4, 'newest first')
})

await checkAsync('the media list is capped at five for the panel', async () => {
  const api = createHarness()
  for (let index = 0; index < 7; index += 1) {
    await api.store.putMedia({
      id: `m${index}`, kind: 'film', title: `片${index}`, status: 'active',
      createdAt: `2026-01-0${index + 1}T00:00:00Z`,
    } as never)
  }
  const stats = buildStats(api.store, MON, MON, boundaryOf(api.config))
  assert.equal(stats.media.recently.length, 5)
  assert.equal(stats.media.recently[0]!.title, '片6', 'newest first')
})

await checkAsync('tasks separate what was done in range from what is still open', async () => {
  const api = createHarness()
  const base = { progress: { current: 0 }, createdAt: 'c' }
  // Written as stored records, because completion is a fact the store stamps
  // rather than an API-settable field: `completedAt` rides with the progress
  // that produced it, so the record and its derived state agree.
  const finish = async (id: string, title: string, due: string, at: string): Promise<void> => {
    await api.store.putTask({
      ...base, id, title, due, progress: { current: 1 }, completedAt: at,
    } as never)
    const shown = api.store.view(WED, WED).tasks.find(entry => entry.id === id)
    assert.equal(shown?.state, 'done', `${id} should read as done`)
  }
  await finish('t1', '迟交', MON, `${WED}T10:00:00`)      // inside range, late
  await finish('t2', '按时', THU, `${WED}T10:00:00`)      // inside range, on time
  await finish('t3', '很久以前', '2026-01-01', `${MON}T10:00:00`) // outside range
  await api.store.putTask({ ...base, id: 't4', title: '还没做', due: MON } as never)

  const stats = buildStats(api.store, WED, WED, boundaryOf(api.config))
  assert.equal(stats.tasks.done, 2, 'two were completed inside the range')
  assert.equal(stats.tasks.doneLate, 1, 'and one of them was already past its due date')
  assert.equal(stats.tasks.open, 1, 'only the untouched task is open')
  assert.equal(stats.tasks.doing, 0)
  assert.equal(stats.tasks.overdue, 1, 'only t4 is past due and unfinished')
})

await checkAsync('a run from a day outside the range is not counted', async () => {
  const api = createHarness()
  await api.store.mutateDay(MON, day => ({ ...day, run: { at: 'x', minutes: 30, distanceKm: 5, avgHr: 150 } }))
  const stats = buildStats(api.store, WED, THU, boundaryOf(api.config))
  assert.equal(stats.runs.count, 0)
  assert.deepEqual(stats.runs.points, [])
})

await checkAsync('the range boundaries are inclusive on both ends', async () => {
  const api = createHarness()
  for (const key of [MON, TUE, WED]) {
    await api.store.mutateDay(key, day => ({ ...day, shower: { at: 'x' } }))
  }
  const stats = buildStats(api.store, MON, WED, boundaryOf(api.config))
  assert.deepEqual(stats.days.map(day => day.date), [MON, TUE, WED])
  assert.equal(stats.habits.find(habit => habit.id === 'shower')!.met, 3)
})

report()
