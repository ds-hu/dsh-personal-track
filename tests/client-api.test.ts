/**
 * The browser half's client, driven against a recording fetch.
 *
 * This is the cross-half contract, and until now nothing asserted it: the only
 * coverage was `verify-client.mjs` checking that each method on the injected
 * face is *a function*, while the real stack spec hand-wrote its own URL and
 * body combinations. A wrong verb, path or envelope in the client left every
 * assertion in the project green.
 *
 * `createHabitClient` now takes a base and a fetch, so every method can be
 * driven with no server — and the route table means the expected verb and path
 * come from the same declaration the host mounts.
 *
 * Runs on Node's native type stripping:
 *   node tests/client-api.test.ts
 */
import { strict as assert } from 'node:assert'
import { createChecker } from './support.ts'
import { HabitApiError, createHabitClient } from '../src/client/api.ts'
import { API_PREFIX, routes, urlOf, type RouteName } from '../src/shared/route.ts'

const checker = createChecker('the client ↔ host contract')
const { check, checkAsync, report } = checker

/** One recorded request. */
interface Recorded {
  readonly url: string
  readonly method: string
  readonly body: Record<string, unknown> | undefined
}

/** A client wired to a recording fetch, plus what it recorded. */
function recording(payload: unknown = { ok: true }, init: ResponseInit = {}): {
  client: ReturnType<typeof createHabitClient>
  calls: Recorded[]
} {
  const calls: Recorded[] = []
  const doFetch = (async (input: RequestInfo | URL, requestInit?: RequestInit) => {
    calls.push({
      url: String(input),
      method: requestInit?.method ?? 'GET',
      body: typeof requestInit?.body === 'string'
        ? JSON.parse(requestInit.body) as Record<string, unknown>
        : undefined,
    })
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    })
  }) as typeof fetch
  return { client: createHabitClient({ doFetch }), calls }
}

/** Every method on the face, with arguments chosen to exercise its path. */
const CALLS: readonly (readonly [RouteName, (client: ReturnType<typeof createHabitClient>) => unknown])[] = [
  ['clock', client => client.clock()],
  ['state', client => client.state('2026-09-16')],
  ['check', client => client.check('2026-09-16', 'wash')],
  ['uncheck', client => client.uncheck('2026-09-16', 'wash', 1)],
  ['editCheck', client => client.editCheck('2026-09-16', 'wash', 0, '07:05')],
  ['setMeal', client => client.setMeal('2026-09-16', 'lunch', { time: '12:00', price: 12.5 })],
  ['clearMeal', client => client.clearMeal('2026-09-16', 'lunch')],
  ['laundryStock', client => client.setStock(5)],
  ['laundryWash', client => client.wash('2026-09-16', 3, '20:00')],
  ['addSession', client => client.addSession('2026-09-16', 'vocab', { minutes: 30 })],
  ['patchSession', client => client.patchSession('2026-09-16', 'vocab', 'v1', { minutes: 45 })],
  ['removeSession', client => client.removeSession('2026-09-16', 'vocab', 'v1')],
  ['setVocabTarget', client => client.setVocabTarget('2026-09-16', { new: 10, review: 5 })],
  ['setRun', client => client.setRun('2026-09-16', { distanceKm: 5 })],
  ['clearRun', client => client.clearRun('2026-09-16')],
  ['addMedia', client => client.addMedia({ kind: 'book', title: '书' })],
  ['patchMedia', client => client.patchMedia('m1', { rating: 5 })],
  ['removeMedia', client => client.removeMedia('m1')],
  ['addTask', client => client.addTask({ title: '作业' })],
  ['patchTask', client => client.patchTask('t1', { progress: { current: 1 } })],
  ['removeTask', client => client.removeTask('t1')],
  ['stats', client => client.stats('2026-09-01', '2026-09-16')],
  ['exportBackup', client => client.exportAll()],
  ['importBackup', client => client.importAll('merge', { format: 'x' })],
  // materials and focus mode
  ['asset', client => client.assetUrl('a1')],
  ['addAsset', client => client.addImageMaterial('task', 't1', { mime: 'image/png', data: 'AA==', name: 'x.png' })],
  ['sweepAssets', client => client.sweepAssets()],
  ['addMaterial', client => client.addTextMaterial('task', 't1', '## 标题')],
  ['patchMaterial', client => client.patchTextMaterial('task', 't1', 'm1', '改过')],
  ['removeMaterial', client => client.removeMaterial('task', 't1', 'm1')],
  ['focusStart', client => client.startFocus('task', 't1')],
  ['focusEnd', client => client.endFocus('task', 't1', 's1')],
]

// --- the binding -------------------------------------------------------------

check('every route in the table is exercised by this test', () => {
  const declared = Object.keys(routes).sort()
  const covered = CALLS.map(([name]) => name).sort()
  assert.deepEqual(covered, declared, 'a new route must be asserted here, not merely added to the table')
})

/**
 * A payload the client accepts, per route.
 *
 * `clock`, `state` and `exportAll` each guard against a stale host half by
 * checking a field is present, so a generic `{ ok: true }` would be rejected
 * before the request under test was ever inspected.
 */
const PAYLOADS: Partial<Record<RouteName, unknown>> = {
  clock: { today: '2026-09-16', nightTail: false, now: 'x', config: {} },
  state: { ok: true, day: { date: '2026-09-16' } },
  exportBackup: { ok: true, backup: { format: 'x' } },
  sweepAssets: { ok: true, removed: 0 },
  focusStart: { ok: true, sessionId: 's1', entry: { id: 't1' } },
}

await checkAsync('every method uses its declared verb and path', async () => {
  for (const [name, call] of CALLS) {
    const { client, calls } = recording(PAYLOADS[name] ?? { ok: true })
    await call(client)
    // The asset route is the exception that proves the rule: `<img src>` points
    // at it and the browser's own image pipeline makes the request, so the
    // client's only job is to build the URL (asserted separately below).
    if (name === 'asset') {
      assert.equal(calls.length, 0, 'asset is fetched by the browser, not by this client')
      continue
    }
    assert.equal(calls.length, 1, `${name} should make exactly one request`)
    const sent = calls[0]!
    assert.equal(sent.method, routes[name].method, `${name} verb`)
    assert.ok(
      sent.url.startsWith(`${API_PREFIX}${routes[name].request}`),
      `${name} path: ${sent.url} should start with ${API_PREFIX}${routes[name].request}`,
    )
  }
})

await checkAsync('the asset URL names the route the host serves bytes on', async () => {
  const client = createHabitClient({ doFetch: (async () => new Response('{}')) as typeof fetch })
  assert.equal(client.assetUrl('a1'), `${API_PREFIX}/asset?id=a1`)
})

await checkAsync('a material write carries the owner, the entry and the payload', async () => {
  const { client, calls } = recording({ ok: true, entry: { id: 't1' } })
  await client.addImageMaterial('media', 'm1', { mime: 'image/png', data: 'AA==', name: '长图.png' })
  assert.equal(calls[0]!.method, 'POST')
  assert.deepEqual(calls[0]!.body, {
    kind: 'media', id: 'm1', mime: 'image/png', data: 'AA==', name: '长图.png',
  })

  const text = recording({ ok: true, entry: { id: 't1' } })
  await text.client.addTextMaterial('task', 't1', '## 标题')
  assert.deepEqual(text.calls[0]!.body, { kind: 'task', id: 't1', text: '## 标题' })

  const removed = recording({ ok: true, entry: { id: 't1' } })
  await removed.client.removeMaterial('task', 't1', 'md1')
  assert.equal(removed.calls[0]!.url, `${API_PREFIX}/material?kind=task&id=t1&materialId=md1`)
  assert.equal(removed.calls[0]!.method, 'DELETE')
})

await checkAsync('query parameters are sent and absent ones are omitted', async () => {
  const { client, calls } = recording({ ok: true, media: [] })
  await client.uncheck('2026-09-16', 'wash', undefined)
  assert.equal(calls[0]!.url, `${API_PREFIX}/check?date=2026-09-16&habit=wash`, 'an absent index is left out, not sent as "undefined"')

  const second = recording({ ok: true, media: [] })
  await second.client.removeMedia('m1')
  assert.equal(second.calls[0]!.url, `${API_PREFIX}/media?id=m1`)
})

await checkAsync('a mutation sends a JSON body with the declared verb', async () => {
  const { client, calls } = recording({ ok: true, day: { date: '2026-09-16' } })
  await client.check('2026-09-16', 'wash')
  assert.equal(calls[0]!.method, 'POST')
  assert.equal(calls[0]!.body?.date, '2026-09-16')
  assert.equal(calls[0]!.body?.habit, 'wash')
})

await checkAsync('the session retime travels inside the patch, as the board sends it', async () => {
  const { client, calls } = recording({ ok: true, day: { date: '2026-09-16' } })
  await client.patchSession('2026-09-16', 'vocab', 'v1', { time: '07:05', minutes: 45 })
  assert.equal(calls[0]!.url, `${API_PREFIX}/session`)
  assert.deepEqual(calls[0]!.body?.patch, { time: '07:05', minutes: 45 })
})

await checkAsync('optional fields are omitted rather than sent as undefined', async () => {
  const { client, calls } = recording({ ok: true, day: { date: '2026-09-16' } })
  await client.setMeal('2026-09-16', 'lunch')
  assert.deepEqual(calls[0]!.body, { date: '2026-09-16', slot: 'lunch' })

  const run = recording({ ok: true, day: { date: '2026-09-16' } })
  await run.client.wash('2026-09-16', 2)
  assert.deepEqual(run.calls[0]!.body, { date: '2026-09-16', pieces: 2 })
})

// --- urlOf -------------------------------------------------------------------

check('urlOf composes the prefix, the path and the query', () => {
  assert.equal(urlOf('clock'), `${API_PREFIX}/clock`)
  assert.equal(urlOf('state', { date: '2026-09-16' }), `${API_PREFIX}/state?date=2026-09-16`)
  assert.equal(urlOf('stats', { from: 'a', to: undefined }), `${API_PREFIX}/stats?from=a`)
  assert.equal(urlOf('laundryWash'), `${API_PREFIX}/laundry/wash`)
})

// --- failures ----------------------------------------------------------------

await checkAsync('a failure payload becomes a typed error carrying the host code', async () => {
  const doFetch = (async () => new Response(
    JSON.stringify({ error: { code: 'habit/check-limit', message: '洗漱每日至多两次' } }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  )) as typeof fetch
  const client = createHabitClient({ doFetch })
  await assert.rejects(
    () => client.check('2026-09-16', 'wash'),
    (cause: unknown) => {
      assert.ok(cause instanceof HabitApiError)
      assert.equal(cause.status, 409)
      assert.equal(cause.code, 'habit/check-limit')
      assert.equal(cause.message, '洗漱每日至多两次')
      return true
    },
  )
})

await checkAsync('a failure with no body still reports the status', async () => {
  const doFetch = (async () => new Response('not json', { status: 502 })) as typeof fetch
  const client = createHabitClient({ doFetch })
  await assert.rejects(
    () => client.clock(),
    (cause: unknown) => cause instanceof HabitApiError && cause.code === 'habit/unknown' && cause.status === 502,
  )
})

await checkAsync('a network failure is reported as unreachable rather than as a crash', async () => {
  const doFetch = (async () => { throw new Error('ECONNREFUSED') }) as typeof fetch
  const client = createHabitClient({ doFetch })
  await assert.rejects(
    () => client.clock(),
    (cause: unknown) => cause instanceof HabitApiError && cause.code === 'habit/unreachable' && cause.status === 0,
  )
})

await checkAsync('a stale host half is named rather than failing on a missing field', async () => {
  const doFetch = (async () => new Response(JSON.stringify({}), {
    status: 200, headers: { 'content-type': 'application/json' },
  })) as typeof fetch
  const client = createHabitClient({ doFetch })
  for (const call of [() => client.clock(), () => client.state('2026-09-16'), () => client.exportAll()]) {
    await assert.rejects(
      call,
      (cause: unknown) => cause instanceof HabitApiError && cause.code === 'habit/stale-host',
    )
  }
})

await checkAsync('the base prefix is overridable, for a test or a differently mounted host', async () => {
  const calls: string[] = []
  const doFetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify({ today: 'x', nightTail: false, now: 'x', config: {} }), { status: 200 })
  }) as typeof fetch
  await createHabitClient({ base: '/elsewhere', doFetch }).clock()
  assert.equal(calls[0], '/elsewhere/clock')
})

report()
