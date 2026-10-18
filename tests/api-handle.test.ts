/**
 * The route handler, driven without a socket.
 *
 * `createApiHandler` was always dependency-injected, but its signature demanded
 * `IncomingMessage`/`ServerResponse`, so the only way to reach a route was to
 * mount a real web server over real storage. Now that it takes the two-method
 * transport it actually uses, every route, every failure shape and every
 * uncovered throw site can be asserted here in-process — fast, deterministic,
 * and with no medium involved.
 *
 * Runs on Node's native type stripping:
 *   node tests/api-handle.test.ts
 *
 * Transport and persistence facts (a real port, a real file, a real restart)
 * deliberately stay in scripts/verify-host.mjs; this file owns the rules.
 */
import { strict as assert } from 'node:assert'
import { createChecker, createHarness } from './support.ts'
import { MAX_IMAGE_BYTES } from '../src/shared/route.ts'
import { MAX_MATERIAL_CHARS } from '../src/host/routes.ts'

const checker = createChecker('route handling (portless)')
const { check, checkAsync, report } = checker

/** The habit day every case works on. */
const DATE = '2026-09-16'

/**
 * An instant's clock time and calendar date *in the local zone*.
 *
 * An ISO string's prefix is UTC, which is not the calendar date the habit day
 * is derived in — asserting on the prefix makes a test pass or fail by the
 * machine's timezone.
 */
const clockOf = (instant: string): string =>
  new Date(instant).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
const localDateOf = (instant: string): string => new Date(instant).toLocaleDateString('en-CA')

/** The JSON error shape every failure must use. */
type ErrorBody = { error: { code: string; message: string } }

// --- reading -----------------------------------------------------------------

await checkAsync('an untouched day reads as an empty bar with the config default', async () => {
  const api = createHarness()
  const state = await api.state('GET', `/state?date=${DATE}`)
  const day = state.day as Record<string, unknown>
  assert.equal(day.day, null, 'an untouched day has no document')
  assert.deepEqual(day.target, { new: 20, review: 60 })
  assert.deepEqual(day.progress, { done: 0, total: 8 })
  assert.equal(day.isToday, true, 'the pinned clock puts DATE on the same day')
  assert.deepEqual(state.stock, { pending: 0, updatedAt: new Date(0).toISOString() })
  assert.deepEqual(state.media, [])
  assert.deepEqual(state.tasks, [])
})

await checkAsync('the clock reports the habit day and the config it was built with', async () => {
  const api = createHarness({ at: '2026-09-16T02:30:00Z' })
  const body = await api.state('GET', '/clock')
  assert.match(String(body.today), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(typeof body.nightTail, 'boolean')
  assert.equal(body.now, '2026-09-16T02:30:00.000Z')
  assert.deepEqual(body.config, {
    dayStartHour: 4,
    defaultVocabTarget: { new: 20, review: 60 },
    defaultRunMinutes: 30,
  })
})

// --- transport failures ------------------------------------------------------

await checkAsync('a malformed body is rejected as bad JSON', async () => {
  const api = createHarness()
  const response = await api.call('POST', '/check', undefined)
  assert.equal(response.status, 400)
  assert.equal((response.body as ErrorBody).error.code, 'habit/bad-request')

  // `{}` parses but fails the schema, which is a different code path.
  const empty = await api.call('PUT', '/meal', {})
  assert.equal(empty.status, 400)
  assert.equal((empty.body as ErrorBody).error.code, 'habit/bad-request')
})

await checkAsync('an oversized body is refused before it is parsed', async () => {
  const api = createHarness()
  const huge = { title: 'x'.repeat(70 * 1024) }
  const response = await api.call('POST', '/tasks', huge)
  assert.equal(response.status, 413)
  assert.equal((response.body as ErrorBody).error.code, 'habit/too-large')
})

await checkAsync('an unknown route names itself', async () => {
  const api = createHarness()
  const response = await api.call('GET', '/nope')
  assert.equal(response.status, 404)
  assert.equal((response.body as ErrorBody).error.code, 'habit/unknown-route')
})

// --- check rules -------------------------------------------------------------

await checkAsync('a third wash on one day is capped, and a shower toggles freely', async () => {
  const api = createHarness()
  await api.state('POST', '/check', { date: DATE, habit: 'wash' })
  await api.state('POST', '/check', { date: DATE, habit: 'wash' })
  const third = await api.call('POST', '/check', { date: DATE, habit: 'wash' })
  assert.equal(third.status, 409)
  assert.equal((third.body as ErrorBody).error.code, 'habit/check-limit')

  // Removing one makes room again.
  await api.state('DELETE', `/check?date=${DATE}&habit=wash`)
  const again = await api.state('POST', '/check', { date: DATE, habit: 'wash' })
  const day = again.day as { day: { washes: { times: string[] } } }
  assert.equal(day.day.washes.times.length, 2)
})

await checkAsync('retiming a wash that does not exist is a 404', async () => {
  const api = createHarness()
  await api.state('POST', '/check', { date: DATE, habit: 'shower' })
  const response = await api.call('PATCH', '/check', {
    date: DATE, habit: 'wash', index: 0, time: '07:00',
  })
  assert.equal(response.status, 404)
  assert.equal((response.body as ErrorBody).error.code, 'habit/not-found')
  assert.match((response.body as ErrorBody).error.message, /打卡/)
})

await checkAsync('retiming a shower that was never taken is a 404', async () => {
  const api = createHarness()
  const response = await api.call('PATCH', '/check', { date: DATE, habit: 'shower', time: '07:00' })
  assert.equal(response.status, 404)
  assert.equal((response.body as ErrorBody).error.code, 'habit/not-found')
  assert.match((response.body as ErrorBody).error.message, /洗澡/)
})

await checkAsync('a retime with neither a time nor an at is refused', async () => {
  const api = createHarness()
  await api.state('POST', '/check', { date: DATE, habit: 'shower' })
  const response = await api.call('PATCH', '/check', { date: DATE, habit: 'shower' })
  assert.equal(response.status, 400)
  assert.equal((response.body as ErrorBody).error.code, 'habit/bad-request')
})

await checkAsync('an impossible clock time is refused wherever it is used', async () => {
  const api = createHarness()
  await api.state('POST', '/check', { date: DATE, habit: 'shower' })
  for (const [method, path, body] of [
    ['POST', '/check', { date: DATE, habit: 'wash', time: '25:00' }],
    ['PATCH', '/check', { date: DATE, habit: 'shower', time: '7点半' }],
    ['PUT', '/meal', { date: DATE, slot: 'lunch', time: '99:99' }],
    ['PUT', '/run', { date: DATE, distanceKm: 5, time: 'noon' }],
  ] as const) {
    const response = await api.call(method, path, body)
    assert.equal(response.status, 400, `${method} ${path} with ${String(body.time)}`)
    assert.equal((response.body as ErrorBody).error.code, 'habit/bad-request')
  }
})

await checkAsync('a malformed date is refused', async () => {
  const api = createHarness()
  const response = await api.call('GET', '/state?date=2026-9-16')
  assert.equal(response.status, 400)
  assert.equal((response.body as ErrorBody).error.code, 'habit/bad-request')
})

// --- sessions ----------------------------------------------------------------

await checkAsync('an unknown session kind is refused by name', async () => {
  const api = createHarness()
  const response = await api.call('POST', '/session', { date: DATE, kind: 'swimming', entry: {} })
  assert.equal(response.status, 400)
  assert.match((response.body as ErrorBody).error.message, /unknown session kind/)

  // A known kind with a wrong entry fails the per-kind schema instead.
  const wrongEntry = await api.call('POST', '/session', {
    date: DATE, kind: 'rope', entry: { preset: 45, seconds: 10 },
  })
  assert.equal(wrongEntry.status, 400)
  assert.match((wrongEntry.body as ErrorBody).error.message, /session rope/)
})

await checkAsync('every session kind lands in its own array and moves the derived cells', async () => {
  const api = createHarness()
  // Exactly the configured default target, so the weighted ratio is exactly 1.
  await api.state('POST', '/session', { date: DATE, kind: 'vocab', entry: { new: 20, review: 60, minutes: 30 } })
  await api.state('POST', '/session', { date: DATE, kind: 'duolingo', entry: { minutes: 12 } })
  await api.state('POST', '/session', { date: DATE, kind: 'rope', entry: { preset: 90, seconds: 45 } })
  await api.state('POST', '/session', { date: DATE, kind: 'pullup', entry: { seconds: 30 } })
  await api.state('POST', '/session', { date: DATE, kind: 'plank', entry: { seconds: 60 } })
  await api.state('POST', '/session', { date: DATE, kind: 'equipment', entry: { name: '划船机', reps: 20, weight: 40 } })

  const state = await api.state('GET', `/state?date=${DATE}`)
  const day = state.day as { day: Record<string, unknown>; vocab: { ratio: number; met: boolean } }
  for (const field of ['vocab', 'duolingo', 'rope', 'pullup', 'plank', 'equipment']) {
    assert.notEqual(day.day[field], undefined, `${field} should be recorded`)
  }
  assert.equal(day.vocab.ratio, 1, 'the vocab sessions satisfy the default target')
  assert.equal(day.vocab.met, true)
  // The two habitual cells follow: vocabulary and duolingo.
  const cells = (state.day as { cells: { id: string; value: number }[] }).cells
  assert.equal(cells.find(cell => cell.id === 'vocab')?.value, 1)
  assert.equal(cells.find(cell => cell.id === 'duolingo')?.value, 1)
  assert.equal((state.day as { progress: { done: number } }).progress.done, 2, 'and nothing else was earned')
})

await checkAsync('a patch merges one session and keeps its id', async () => {
  const api = createHarness()
  const added = await api.state('POST', '/session', {
    date: DATE, kind: 'vocab', entry: { new: 1, review: 2, minutes: 3 },
  })
  const sessions = (added.day as { day: { vocab: { sessions: { id: string; new: number; minutes: number }[] } } })
    .day.vocab.sessions
  const id = sessions[0]!.id

  const patched = await api.state('PATCH', '/session', {
    date: DATE, kind: 'vocab', id, patch: { minutes: 45 },
  })
  const next = (patched.day as { day: { vocab: { sessions: { id: string; new: number; minutes: number }[] } } })
    .day.vocab.sessions
  assert.equal(next.length, 1, 'no new session was appended')
  assert.equal(next[0]!.id, id, 'the id survives the patch')
  assert.equal(next[0]!.minutes, 45, 'the patched field changed')
  assert.equal(next[0]!.new, 1, 'and the untouched fields were not clobbered')
})

await checkAsync('a session can be retimed without losing the instant it already had', async () => {
  const api = createHarness()
  // A patch that carries no time must leave the stored instant exactly as it
  // was: the route resolves `time` from beside `patch`, so a missing one falls
  // back to the entry's own `at` rather than dropping it.
  const added = await api.state('POST', '/session', {
    date: DATE, kind: 'duolingo', entry: { minutes: 12, at: `${DATE}T09:00:00` },
  })
  const entry = (added.day as { day: { duolingo: { id: string; at: string }[] } }).day.duolingo[0]!
  assert.equal(entry.at, `${DATE}T09:00:00`)

  const patched = await api.state('PATCH', '/session', {
    date: DATE, kind: 'duolingo', id: entry.id, patch: { minutes: 20 },
  })
  const after = (patched.day as { day: { duolingo: { at: string; minutes: number }[] } }).day.duolingo[0]!
  assert.equal(after.at, `${DATE}T09:00:00`, 'the instant survived a metric-only patch')
  assert.equal(after.minutes, 20)
})

await checkAsync('a retime replaces the instant, whichever shape it arrives in', async () => {
  // Three callers send the clock three ways; all three must land. The
  // `patch.time` form is the one the board's own editor produces, because its
  // time input is just another field in the form payload — and it is the shape
  // a refactor is most likely to drop, since it hides inside `patch`.
  const shapes: readonly (readonly [string, Record<string, unknown>])[] = [
    ['top-level time', { time: '07:05', patch: { minutes: 15 } }],
    ['time inside the patch', { patch: { time: '07:05', minutes: 15 } }],
  ]
  for (const [label, extra] of shapes) {
    const api = createHarness()
    const added = await api.state('POST', '/session', {
      date: DATE, kind: 'duolingo', entry: { minutes: 12, at: `${DATE}T09:00:00` },
    })
    const id = (added.day as { day: { duolingo: { id: string }[] } }).day.duolingo[0]!.id

    const patched = await api.state('PATCH', '/session', { date: DATE, kind: 'duolingo', id, ...extra })
    const entry = (patched.day as { day: { duolingo: { at: string; minutes: number }[] } }).day.duolingo[0]!
    assert.equal(clockOf(entry.at), '07:05', `${label} should retime the entry`)
    assert.notEqual(entry.at, `${DATE}T09:00:00`)
    assert.equal(entry.minutes, 15, `${label} should still apply the rest of the patch`)
    // The habit day still owns the instant: the board only ever sends `HH:mm`.
    assert.equal((patched.day as { date: string }).date, DATE)
  }
})

await checkAsync('a taken check can be retimed to a night-tail hour', async () => {
  const api = createHarness()
  await api.state('POST', '/check', { date: DATE, habit: 'wash' })
  const patched = await api.state('PATCH', '/check', { date: DATE, habit: 'wash', index: 0, time: '01:30' })
  const times = (patched.day as { day: { washes: { times: string[] } } }).day.washes.times
  assert.equal(clockOf(times[0]!), '01:30')
  assert.equal(localDateOf(times[0]!), '2026-09-17', 'a night-tail hour lands on the next calendar date …')
  assert.equal(
    (patched.day as { cells: { id: string; value: number }[] }).cells.find(cell => cell.id === 'wash1')?.value,
    1,
    '… while still counting inside the habit day',
  )
})

// --- the registry write chain ------------------------------------------------

await checkAsync('an unknown media id reaches the 404 mapping through missing-key', async () => {
  const api = createHarness()
  const response = await api.call('PATCH', '/media', { id: 'nobody', patch: { rating: 5 } })
  assert.equal(response.status, 404)
  assert.equal(
    (response.body as ErrorBody).error.code,
    'habit/not-found',
    'the store rejecting with missing-key must not surface as a 500',
  )

  const removed = await api.state('DELETE', '/media?id=nobody')
  assert.equal(removed.removed, false, 'deleting an absent record is not an error')
})

await checkAsync('a task patch merges progress, clears on null and follows completion', async () => {
  const api = createHarness()
  const created = await api.state('POST', '/tasks', { title: '线代作业', category: '数学', due: DATE })
  const id = (created.entry as { id: string }).id
  // `entry` is the view too (asserted separately below); these assertions read
  // through the list because they are about what the refreshed list reports.
  const listed = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.tasks as Record<string, unknown>[]).find(task => task.id === id) as Record<string, unknown>

  const doing = await api.state('PATCH', '/tasks', { id, patch: { progress: { current: 3, total: 5 } } })
  assert.equal(listed(doing).state, 'doing')
  assert.equal(listed(doing).completedAt, undefined)

  const merged = await api.state('PATCH', '/tasks', { id, patch: { progress: { current: 4 } } })
  assert.equal((listed(merged).progress as { total: number }).total, 5, 'progress merges field by field')

  const finished = await api.state('PATCH', '/tasks', { id, patch: { progress: { current: 5 } } })
  assert.equal(listed(finished).state, 'done')
  assert.equal(typeof listed(finished).completedAt, 'string', 'reaching the target stamps the completion instant')

  const reopened = await api.state('PATCH', '/tasks', { id, patch: { progress: { current: 1 } } })
  assert.equal(listed(reopened).state, 'doing')
  assert.equal(listed(reopened).completedAt, undefined, 'reopening clears the completion instant')

  const cleared = await api.state('PATCH', '/tasks', { id, patch: { due: null, category: null } })
  assert.equal(listed(cleared).due, undefined, 'null clears the due date')
  assert.equal(listed(cleared).category, undefined, 'null clears the category')
})

await checkAsync('checkpoints travel as content and follow the progress over HTTP', async () => {
  const api = createHarness()
  const created = await api.state('POST', '/tasks', {
    title: '线代作业', progress: { current: 0, total: 30 },
    checkpoints: [{ label: '第一章', at: 10 }, { label: '第二章', at: 20 }],
  })
  const id = (created.entry as { id: string }).id
  const entryOf = (body: Record<string, unknown>): Record<string, unknown> =>
    (body.tasks as Record<string, unknown>[]).find(task => task.id === id) as Record<string, unknown>

  const stored = created.entry as {
    checkpoints: { id: string; label: string; at: number; reachedAt?: string }[]
  }
  assert.equal(stored.checkpoints.length, 2, 'the wire sent content; the host assigned the ids')
  assert.ok(stored.checkpoints.every(checkpoint => checkpoint.id), 'no id is ever the caller\'s to choose')

  const crossed = await api.state('PATCH', '/tasks', { id, patch: { progress: { current: 12 } } })
  const checkpoints = entryOf(crossed).checkpoints as { label: string; reachedAt?: string }[]
  assert.equal(typeof checkpoints.find(c => c.label === '第一章')!.reachedAt, 'string', 'crossing stamps the instant')
  assert.equal(checkpoints.find(c => c.label === '第二章')!.reachedAt, undefined, 'the stage ahead keeps nothing')

  const refused = await api.call('PATCH', '/tasks', { id, patch: { progress: { total: null } } })
  assert.equal(refused.status, 400, 'clearing the axis under the stages')
  assert.equal((refused.body as ErrorBody).error.code, 'habit/task-checkpoints-need-total')

  const emptied = await api.state('PATCH', '/tasks', { id, patch: { checkpoints: [] } })
  assert.deepEqual(entryOf(emptied).checkpoints, [], 'an emptied list is the "remove them all"')
  const after = await api.call('PATCH', '/tasks', { id, patch: { progress: { total: null } } })
  assert.equal(after.status, 200, 'with the stages gone, the total may go too')
})

// --- materials and focus mode ------------------------------------------------

/** One tiny PNG, base64: the smallest thing that is still an image payload. */
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

await checkAsync('an image travels as bytes and reads back as a binary response', async () => {
  const api = createHarness()
  const task = await api.state('POST', '/tasks', { title: '线代作业' })
  const id = (task.entry as { id: string }).id

  const added = await api.entry('POST', '/asset', {
    kind: 'task', id, mime: 'image/png', data: TINY_PNG, name: '讲义.png',
  })
  const material = (added.materials as { kind: string; assetId: string; mime?: string; bytes?: number }[])[0]
  assert.equal(material?.kind, 'image')
  assert.equal(material?.mime, 'image/png', 'mime is derived from the asset document')
  assert.equal(material?.bytes, Buffer.from(TINY_PNG, 'base64').length, 'and so is the size')

  const fetched = await api.call('GET', `/asset?id=${material!.assetId}`)
  assert.equal(fetched.status, 200)
  assert.equal(fetched.contentType, 'image/png', 'the response carries the stored mime')
  assert.deepEqual(fetched.bytes, Buffer.from(TINY_PNG, 'base64'), 'and the bytes it stored')
  assert.equal(fetched.body.ok, undefined, 'a binary response is not a JSON envelope')
})

await checkAsync('a missing image is a 404, not an empty picture', async () => {
  const api = createHarness()
  const missing = await api.call('GET', '/asset?id=nope')
  assert.equal(missing.status, 404)
  assert.equal((missing.body as ErrorBody).error.code, 'habit/not-found')
  const bare = await api.call('GET', '/asset')
  assert.equal(bare.status, 400, 'the id is required')
})

await checkAsync('a payload that is not base64, or is over the wire cap, is refused', async () => {
  const api = createHarness()
  const task = await api.state('POST', '/tasks', { title: '作业' })
  const id = (task.entry as { id: string }).id

  const notBase64 = await api.call('POST', '/asset', { kind: 'task', id, mime: 'image/png', data: 'not base64!!' })
  assert.equal(notBase64.status, 400)
  assert.equal((notBase64.body as ErrorBody).error.code, 'habit/bad-request')

  // One byte over the shared cap, encoded the way the browser half would.
  const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64')
  const tooBig = await api.call('POST', '/asset', { kind: 'task', id, mime: 'image/png', data: oversized })
  assert.equal(tooBig.status, 400, 'the host enforces the same cap the picker does')

  const unknownOwner = await api.call('POST', '/asset', { kind: 'task', id: 'nope', mime: 'image/png', data: TINY_PNG })
  assert.equal(unknownOwner.status, 404, 'a material on a vanished entry is a missing key')
})

await checkAsync('text blocks are added, rewritten and removed over HTTP', async () => {
  const api = createHarness()
  const task = await api.state('POST', '/tasks', { title: '作业' })
  const id = (task.entry as { id: string }).id

  const first = await api.entry('POST', '/material', { kind: 'task', id, text: '## 第一块' })
  const material = (first.materials as { id: string; text: string }[])[0]
  assert.equal(material?.text, '## 第一块')

  const patched = await api.entry('PATCH', '/material', {
    kind: 'task', id, materialId: material!.id, text: '改过',
  })
  assert.equal((patched.materials as { text: string }[])[0]?.text, '改过')

  const removed = await api.entry('DELETE', `/material?kind=task&id=${id}&materialId=${material!.id}`)
  assert.deepEqual(removed.materials, [], 'the block is gone')

  const tooLong = await api.call('POST', '/material', { kind: 'task', id, text: 'x'.repeat(MAX_MATERIAL_CHARS + 1) })
  assert.equal(tooLong.status, 400, 'one block is bounded in characters, not bytes')
})

await checkAsync('focus sessions open, close, and answer with the entry', async () => {
  const api = createHarness()
  const task = await api.state('POST', '/tasks', { title: '作业' })
  const id = (task.entry as { id: string }).id

  const response = await api.call('POST', '/focus', { kind: 'task', id })
  assert.equal(response.status, 200)
  const sessionId = response.body.sessionId
  assert.equal(typeof sessionId, 'string', 'the session just opened is named back')
  const entry = response.body.entry as { focusSessions: { endedAt?: string }[]; focusSeconds: number }
  assert.equal(entry.focusSessions.length, 1)
  assert.equal(entry.focusSessions[0]?.endedAt, undefined, 'still open')
  assert.equal(entry.focusSeconds, 0, 'an open session contributes no time')

  const closed = await api.entry('PATCH', '/focus', { kind: 'task', id, sessionId })
  const sessions = closed.focusSessions as { endedAt?: string }[]
  assert.equal(typeof sessions[0]?.endedAt, 'string', 'closing stamps the end the host chose')
  assert.equal(closed.focusSeconds, 0, 'the pinned clock makes the session zero-length')
})

/**
 * A registry write's answer is an *entry view*, on both registries.
 *
 * Focus mode adopts that answer as its whole entry, so the shape is not a
 * detail: the stored record carries neither the mime/size a material derives
 * from the asset table nor the derived `focusSeconds`/`state`, and a client
 * that adopts it draws every image on the entry as missing and its focus time
 * as NaN. That is exactly what a progress bar dragged in focus mode used to do.
 */
await checkAsync('a registry write answers with the entry in the view\'s shape', async () => {
  const api = createHarness()
  const task = await api.state('POST', '/tasks', { title: '线代作业', progress: { current: 0, total: 10 } })
  const id = (task.entry as { id: string }).id
  await api.entry('POST', '/asset', { kind: 'task', id, mime: 'image/png', data: TINY_PNG, name: '讲义.png' })
  // One closed session, so the entry has a real (zero-length, pinned clock) total.
  const focused = await api.call('POST', '/focus', { kind: 'task', id })
  await api.call('PATCH', '/focus', { kind: 'task', id, sessionId: focused.body.sessionId })

  const patched = await api.entry('PATCH', '/tasks', { id, patch: { progress: { current: 4 } } })
  const image = (patched.materials as { kind: string; mime?: string; bytes?: number }[])[0]
  assert.equal(image?.kind, 'image')
  assert.equal(image?.mime, 'image/png', 'the material carries the mime derived from its asset')
  assert.equal(image?.bytes, Buffer.from(TINY_PNG, 'base64').length, 'and its derived size')
  assert.equal(typeof patched.focusSeconds, 'number', 'the focus total is on the entry, not only on the list')
  assert.equal(patched.state, 'doing', 'and so is the derived task state')

  const created = await api.entry('POST', '/tasks', { title: '新任务' })
  assert.equal(created.state, 'todo', 'a created task answers as the view too')
  assert.equal(created.focusSeconds, 0)

  // The same contract on the other registry: an image material and the derived
  // focus total have to survive a media write as well.
  const book = await api.entry('POST', '/media', { kind: 'book', title: '三体' })
  await api.entry('POST', '/asset', { kind: 'media', id: String(book.id), mime: 'image/png', data: TINY_PNG })
  const noted = await api.entry('PATCH', '/media', { id: String(book.id), patch: { notes: '读到第三章' } })
  const cover = (noted.materials as { kind: string; mime?: string }[])[0]
  assert.equal(cover?.mime, 'image/png', 'a media write answers with the material view too')
  assert.equal(typeof noted.focusSeconds, 'number', 'and with its derived focus total')
  assert.equal(noted.notes, '读到第三章')
})

await checkAsync('the sweep reclaims an orphan an interrupted write left behind', async () => {
  const api = createHarness()
  const task = await api.state('POST', '/tasks', { title: '作业' })
  const id = (task.entry as { id: string }).id
  const added = await api.entry('POST', '/asset', { kind: 'task', id, mime: 'image/png', data: TINY_PNG })
  const material = (added.materials as { kind: string; id: string }[])[0]

  const clean = await api.call('POST', '/asset/sweep')
  assert.equal((clean.body as { removed: number }).removed, 0, 'a referenced image is not an orphan')

  await api.entry('DELETE', `/material?kind=task&id=${id}&materialId=${material!.id}`)
  const after = await api.call('POST', '/asset/sweep')
  assert.equal((after.body as { removed: number }).removed, 0, 'removing a material already took its bytes')
})

// --- backup ------------------------------------------------------------------

await checkAsync('an unreadable backup is refused whole and writes nothing', async () => {
  const api = createHarness()
  await api.state('POST', '/tasks', { title: '留下的任务' })

  const notOurs = await api.call('POST', '/backup', { mode: 'merge', backup: { hello: 'world' } })
  assert.equal(notOurs.status, 400)
  assert.equal((notOurs.body as ErrorBody).error.code, 'habit/bad-backup')

  const badVersion = await api.call('POST', '/backup', { mode: 'merge', backup: { format: 'personal-track/backup', version: 99 } })
  assert.equal(badVersion.status, 400)
  assert.match((badVersion.body as ErrorBody).error.message, /版本/)

  const day = await api.state('GET', `/state?date=${DATE}`)
  assert.equal((day.tasks as unknown[]).length, 1, 'the local task survived both refusals')
})

await checkAsync('one corrupt record fails the whole bundle', async () => {
  const api = createHarness()
  const exported = await api.call('GET', '/backup')
  const backup = exported.body.backup as { days: unknown[] }
  const corrupt = { ...backup, days: [{ date: DATE, washes: { times: 'nope' } }] }
  const response = await api.call('POST', '/backup', { mode: 'merge', backup: corrupt })
  assert.equal(response.status, 400)
  assert.equal((response.body as ErrorBody).error.code, 'habit/bad-backup')
})

// --- statistics --------------------------------------------------------------

await checkAsync('a reversed or oversized stats range is refused', async () => {
  const api = createHarness()
  const reversed = await api.call('GET', '/stats?from=2026-09-16&to=2026-09-01')
  assert.equal(reversed.status, 400)
  assert.match((reversed.body as ErrorBody).error.message, /from/)

  const huge = await api.call('GET', '/stats?from=2000-01-01&to=2026-09-16')
  assert.equal(huge.status, 400)
  assert.equal((huge.body as ErrorBody).error.code, 'habit/range-too-large')
})

// --- the two catch-all branches ----------------------------------------------

await checkAsync('a deleted document reaches the 404 mapping, not the catch-all', async () => {
  const api = createHarness()
  // The medium rejects a write to a key it no longer holds, and `dsh-storage-domain`
  // reports that as a `missing-key` rejection rather than an HTTP-shaped error.
  // The route layer must recognise it, so raise it from the same place the real
  // domain would: underneath the read that precedes the write.
  Object.defineProperty(api.store, 'dayFacts', {
    configurable: true,
    value: () => { throw Object.assign(new Error('missing-key: 2026-09-16'), { code: 'missing-key' }) },
  })

  const response = await api.call('GET', `/state?date=${DATE}`)
  assert.equal(response.status, 404)
  assert.equal((response.body as ErrorBody).error.code, 'habit/not-found')
  assert.equal((response.body as ErrorBody).error.message, 'no such record')
})

await checkAsync('an unexpected failure is logged and reported as internal', async () => {
  const api = createHarness()
  const original = api.store.view
  Object.defineProperty(api.store, 'view', {
    value: () => { throw new Error('boom') },
    configurable: true,
  })
  const logged = console.error
  const seen: unknown[] = []
  console.error = (...args: unknown[]) => { seen.push(args) }
  try {
    const response = await api.call('GET', `/state?date=${DATE}`)
    assert.equal(response.status, 500)
    assert.equal((response.body as ErrorBody).error.code, 'habit/internal')
    assert.equal((response.body as ErrorBody).error.message, 'internal error', 'the cause is not returned')
    assert.equal(seen.length, 1, 'the cause is logged instead')
  } finally {
    console.error = logged
    Object.defineProperty(api.store, 'view', { value: original, configurable: true })
  }
})

report()
