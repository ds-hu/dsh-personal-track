/**
 * End-to-end host verification against the real framework services.
 *
 * Mounts the actual storage hub, the JSON backend, the domain facility, the
 * web server, and the built plugin on a real Cordis context, then drives the
 * plugin's own HTTP API and inspects what actually landed on disk. A second
 * mount over the same root proves the data survives a restart.
 *
 * What this file owns is *transport and persistence*: a real port, a real JSON
 * document, a real restart, a real backup round-trip across two roots. The
 * rules themselves — every derivation, every failure shape, every mutation —
 * are asserted in `tests/`, in-process and without a medium, so this file does
 * not repeat them.
 *
 * The storage root lives inside the workspace (`.tmp/`) because the file
 * sandbox grants no writes to the platform temp directory.
 */
import { strict as assert } from 'node:assert'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as storageJson from '@deepseek-ai/dsh-storage-json'
import * as storageDomain from '@deepseek-ai/dsh-storage-domain'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as plugin from '../lib/index.js'

const ROOT = join('.tmp', 'verify-host')
const DATE = '2026-09-16'

/**
 * The instant every record is stamped with.
 *
 * Built from local components, so the habit day is `DATE` on any machine: the
 * plugin derives the day in the host's zone, and a UTC literal would land on
 * the previous or next day west or east of it. Pinning the clock is what makes
 * "a task due today" and "completed inside the range" deterministic instead of
 * something this file has to ask the wall clock about.
 */
const NOW = new Date(2026, 8, 16, 12, 0, 0)

/** An instant's clock time in the local zone (an ISO prefix is UTC). */
const clockOf = (instant) =>
  new Date(instant).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

await rm(ROOT, { recursive: true, force: true })
await mkdir(ROOT, { recursive: true })

/** Mount the whole stack over `root`; returns a request helper plus a teardown. */
async function mount(root = ROOT) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(storageJson, { root })
  await ctx.plugin(storageDomain, { backend: 'json' })
  const server = await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const app = await ctx.plugin(plugin, {
    dayStartHour: 4,
    now: () => new Date(NOW.getTime()),
  })

  const deadline = Date.now() + 5000
  while (!ctx.webServer?.port) {
    assert.ok(Date.now() < deadline, 'the web server never reported a listening port')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  const base = `http://127.0.0.1:${ctx.webServer.port}/habit/api`

  return {
    async call(method, path, body) {
      const response = await fetch(`${base}${path}`, {
        method,
        ...(body === undefined ? {} : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      })
      return { status: response.status, body: await response.json() }
    },
    /**
     * One request whose response is bytes rather than JSON.
     *
     * The asset route is the only one, and it cannot go through `call`: asking
     * a PNG for `.json()` is the bug this helper exists to avoid.
     */
    async raw(method, path) {
      const response = await fetch(`${base}${path}`, { method })
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: Buffer.from(await response.arrayBuffer()),
      }
    },
    async stop() {
      await app.dispose()
      await server.dispose()
    },
  }
}

const api = await mount()

// --- clock + an untouched day -------------------------------------------------
const clock = await api.call('GET', '/clock')
assert.equal(clock.status, 200)
assert.match(clock.body.today, /^\d{4}-\d{2}-\d{2}$/)
assert.equal(typeof clock.body.nightTail, 'boolean')
assert.equal(clock.body.config.dayStartHour, 4)

const empty = await api.call('GET', `/state?date=${DATE}`)
assert.equal(empty.status, 200)
assert.equal(empty.body.day.day, null, 'an untouched day has no document')
assert.deepEqual(empty.body.day.target, { new: 20, review: 60 }, 'the config default is inherited')
assert.deepEqual(empty.body.day.progress, { done: 0, total: 8 })
assert.equal(empty.body.stock.pending, 0)
console.log('clock + untouched day ✓  (no document, config default target, 0/8)')

// --- vocabulary target snapshot ----------------------------------------------
const targeted = await api.call('PUT', '/vocab-target', { date: DATE, new: 10, review: 5 })
assert.equal(targeted.status, 200)
assert.deepEqual(targeted.body.day.target, { new: 10, review: 5 })

// --- checks (counted, capped, individually removable) -------------------------
await api.call('POST', '/check', { date: DATE, habit: 'wash' })
const two = await api.call('POST', '/check', { date: DATE, habit: 'wash' })
assert.equal(two.body.day.day.washes.times.length, 2)
const third = await api.call('POST', '/check', { date: DATE, habit: 'wash' })
assert.equal(third.status, 409, 'a third wash in one day is refused')
assert.equal(third.body.error.code, 'habit/check-limit')
const undone = await api.call('DELETE', `/check?date=${DATE}&habit=wash`)
assert.equal(undone.body.day.day.washes.times.length, 1)
await api.call('POST', '/check', { date: DATE, habit: 'shower' })
console.log('checks ✓  (counted, capped at two, removable, shower toggles on)')

// --- meal slot ----------------------------------------------------------------
const meal = await api.call('PUT', '/meal', { date: DATE, slot: 'lunch', price: 12.5 })
assert.equal(meal.body.day.day.meals.lunch.price, 12.5)
assert.equal(typeof meal.body.day.day.meals.lunch.at, 'string', 'the server stamps the time')
console.log('meal slot ✓  (server-stamped time + price)')

// --- sessions and derived cells ----------------------------------------------
const vocab = await api.call('POST', '/session', {
  date: DATE,
  kind: 'vocab',
  entry: { new: 10, review: 5, minutes: 30 },
})
assert.equal(vocab.status, 200)
assert.equal(vocab.body.day.vocab.met, true, 'the sessions satisfy the target')
assert.equal(vocab.body.day.vocab.minutes, 30)
const sessionId = vocab.body.day.day.vocab.sessions[0].id
assert.ok(sessionId, 'a session carries a stable id')

const patched = await api.call('PATCH', '/session', {
  date: DATE,
  kind: 'vocab',
  id: sessionId,
  patch: { minutes: 45 },
})
assert.equal(patched.body.day.vocab.minutes, 45, 'editing a session recomputes progress')

const lesson = await api.call('POST', '/session', { date: DATE, kind: 'duolingo', entry: { minutes: 12 } })
assert.equal(lesson.body.day.cells.find(cell => cell.id === 'duolingo').value, 1)
assert.equal(lesson.body.day.progress.done, 5, 'wash + shower + lunch + vocab + duolingo')
const lessonId = lesson.body.day.day.duolingo[0].id

const removed = await api.call('DELETE', `/session?date=${DATE}&kind=vocab&id=${sessionId}`)
assert.equal(removed.body.day.vocab.met, false, 'removing a session takes the cell back')
assert.equal(removed.body.day.progress.done, 4)
console.log('sessions ✓  (append / patch / delete, cells follow the sessions)')

// --- editing recorded times --------------------------------------------------
// A `HH:mm` retime over real HTTP: the host, not the browser, decides which
// calendar date a clock time lands on. The full night-tail and per-verb matrix
// lives in tests/api-handle.test.ts; what matters here is that a retime travels
// through the real transport and comes back changed.
const retimedShower = await api.call('PATCH', '/check', { date: DATE, habit: 'shower', time: '07:05' })
assert.equal(retimedShower.status, 200)
assert.equal(clockOf(retimedShower.body.day.day.shower.at), '07:05', 'a shower time can be corrected')

const retimedLesson = await api.call('PATCH', '/session', {
  date: DATE, kind: 'duolingo', id: lessonId, patch: { time: '21:15' },
})
assert.equal(clockOf(retimedLesson.body.day.day.duolingo[0].at), '21:15', 'a session time can be corrected')

const badTime = await api.call('PATCH', '/check', { date: DATE, habit: 'wash', index: 0, time: '25:00' })
assert.equal(badTime.status, 400, 'an impossible clock time is refused')
console.log('time editing ✓  (a retime travels over HTTP; an impossible time is refused)')

// --- running (single-valued, default duration) -------------------------------
const run = await api.call('PUT', '/run', { date: DATE, distanceKm: 5, avgHr: 150 })
assert.equal(run.body.day.day.run.minutes, 30, 'the duration defaults from config')
assert.equal(run.body.day.day.run.distanceKm, 5)
console.log('running ✓  (one per day, duration defaulted)')

// --- laundry: stock correction vs a wash event -------------------------------
const stock = await api.call('PATCH', '/laundry/stock', { pending: 5 })
assert.equal(stock.body.stock.pending, 5)
const washed = await api.call('POST', '/laundry/wash', { date: DATE, pieces: 3 })
assert.equal(washed.body.stock.pending, 2, 'the wash decrements the stock')
assert.equal(washed.body.day.day.washing.length, 1, 'and leaves a washing session behind')
assert.equal(washed.body.day.day.washing[0].pieces, 3)
console.log('laundry ✓  (correction leaves no event; a wash decrements and records)')

// --- training session kinds (M3) --------------------------------------------
const rope = await api.call('POST', '/session', {
  date: DATE, kind: 'rope', entry: { preset: 90, seconds: 45, avgHr: 130 },
})
assert.equal(rope.status, 200)
assert.equal(rope.body.day.day.rope.length, 1)
assert.equal(rope.body.day.day.rope[0].preset, 90, 'the preset stays a number, not a string')
const rope180 = await api.call('POST', '/session', {
  date: DATE, kind: 'rope', entry: { preset: 180, seconds: 95 },
})
assert.equal(rope180.body.day.day.rope.length, 2, 'several sets a day are allowed')

const pullup = await api.call('POST', '/session', { date: DATE, kind: 'pullup', entry: { seconds: 32 } })
assert.equal(pullup.body.day.day.pullup[0].seconds, 32)

const equipment = await api.call('POST', '/session', {
  date: DATE, kind: 'equipment', entry: { name: '划船机', reps: 30, weight: 40 },
})
assert.equal(equipment.body.day.day.equipment[0].name, '划船机')

const badKind = await api.call('POST', '/session', { date: DATE, kind: 'swimming', entry: {} })
assert.equal(badKind.status, 400, 'an unknown session kind is refused')
assert.equal(badKind.body.error.code, 'habit/bad-request')
console.log('training sessions ✓  (rope presets stay numeric, any number of sets, unknown kinds refused)')

const changedRun = await api.call('PUT', '/run', { date: DATE, minutes: 25, distanceKm: 5 })
assert.equal(changedRun.body.day.day.run.minutes, 25, 'an explicit duration wins over the default')
const clearedRun = await api.call('DELETE', `/run?date=${DATE}`)
assert.equal(clearedRun.body.day.day.run, null, 'the running entry can be cleared')
console.log('running edit ✓  (explicit duration, then cleared)')

// --- tasks (derived state) and media (hard delete) ---------------------------
// With the clock pinned, "today" is the same day this file keeps writing to, so
// a task due today is never overdue on the day it is created.
assert.equal(clock.body.today, DATE, 'the pinned clock and the working date agree')
const task = await api.call('POST', '/tasks', { title: '线代作业', category: '数学', due: DATE })
const taskId = task.body.entry.id
assert.equal(task.body.tasks[0].state, 'todo', 'a fresh task reads as 待办')
assert.equal(task.body.tasks[0].overdue, false)
const ofTask = response => response.body.tasks.find(entry => entry.id === taskId)

const progressed = await api.call('PATCH', '/tasks', { id: taskId, patch: { progress: { current: 3, total: 5 } } })
assert.equal(ofTask(progressed).progress.total, 5, 'progress merges field by field')
assert.equal(ofTask(progressed).state, 'doing', 'partial progress reads as 进行中')
assert.equal(ofTask(progressed).completedAt, undefined, 'nothing finished yet')

const finished = await api.call('PATCH', '/tasks', { id: taskId, patch: { progress: { current: 5 } } })
assert.equal(ofTask(finished).state, 'done', 'reaching the target completes it')
assert.equal(typeof ofTask(finished).completedAt, 'string', 'and the store stamps the completion instant')

const reopened = await api.call('PATCH', '/tasks', { id: taskId, patch: { progress: { current: 2 } } })
assert.equal(ofTask(reopened).state, 'doing')
assert.equal(ofTask(reopened).completedAt, undefined, 'reopening clears the completion instant')

const clearedFields = await api.call('PATCH', '/tasks', { id: taskId, patch: { due: null, category: null } })
assert.equal(ofTask(clearedFields).due, undefined, 'null clears the due date')
assert.equal(ofTask(clearedFields).category, undefined, 'null clears the category')
const badDue = await api.call('PATCH', '/tasks', { id: taskId, patch: { due: '下周三' } })
assert.equal(badDue.status, 400, 'a malformed due date is refused')

const late = await api.call('POST', '/tasks', { title: '补交作业', due: '2020-01-01' })
const lateId = late.body.entry.id
assert.equal(late.body.tasks.find(entry => entry.id === lateId).overdue, true, 'past due and unfinished')
await api.call('PATCH', '/tasks', { id: lateId, patch: { progress: { current: 1 } } })
const lateList = await api.call('GET', `/state?date=${DATE}`)
assert.equal(lateList.body.tasks.find(entry => entry.id === lateId).overdue, false, 'finishing clears overdue')

const book = await api.call('POST', '/media', { kind: 'book', title: '设计数据密集型应用' })
const bookId = book.body.entry.id
assert.equal(book.body.entry.status, 'active')
const rated = await api.call('PATCH', '/media', { id: bookId, patch: { rating: 5, status: 'done' } })
assert.equal(rated.body.entry.rating, 5)
assert.equal(rated.body.entry.status, 'done')
const unrated = await api.call('PATCH', '/media', { id: bookId, patch: { rating: null } })
assert.equal(unrated.body.entry.rating, undefined, 'null clears the rating')
const dropped = await api.call('DELETE', `/media?id=${bookId}`)
assert.equal(dropped.body.removed, true, 'media delete is a hard delete')
assert.equal(dropped.body.media.length, 0)
console.log('tasks + media ✓  (derived state, completion instant, null clears, hard delete)')

// --- a task due today is a cell in today's bar --------------------------------
// The day stands at 4 complete cells (one wash, a shower, lunch, duolingo); the
// task adds a fifth denominator without moving the numerator yet.
const dated = await api.call('POST', '/tasks', { title: '今日作业', due: DATE })
const datedId = dated.body.entry.id
const withCell = (await api.call('GET', `/state?date=${DATE}`)).body
assert.equal(withCell.day.progress.total, 9, 'a task due that day adds a cell to the bar')
assert.equal(withCell.day.cells.at(-1).id, `task:${datedId}`)
assert.equal(withCell.day.cells.at(-1).label, '今日作业', 'the cell carries the task title')
assert.equal(withCell.day.cells.at(-1).value, 0, 'and starts empty')
assert.equal(withCell.day.progress.done, 4, 'an untouched task moves nothing yet')

await api.call('PATCH', '/tasks', { id: datedId, patch: { progress: { current: 1, total: 4 } } })
const quarter = (await api.call('GET', `/state?date=${DATE}`)).body
assert.equal(quarter.day.cells.at(-1).value, 0.25, 'progress fills the cell fractionally')
assert.equal(quarter.day.progress.done, 4.3, 'a quarter of a cell reads as one decimal')
// A different day is untouched by it, because only the deadline links them.
const other = (await api.call('GET', '/state?date=2026-09-19')).body
assert.equal(other.day.progress.total, 8, 'the cell belongs to the due date alone')

await api.call('DELETE', `/tasks?id=${datedId}`)
const dropped2 = (await api.call('GET', `/state?date=${DATE}`)).body
assert.equal(dropped2.day.progress.total, 8, 'deleting the task takes its cell back')
assert.equal(dropped2.day.progress.done, 4)
console.log('due-today cells ✓  (one cell per due task, fractional value, gone with the task)')

// --- range statistics --------------------------------------------------------
// `buildStats` itself is covered exhaustively in tests/stats.test.ts. What this
// file checks is that the aggregate travels over real HTTP against real stored
// records: one request, the whole panel, one day of data.
const dayStats = (await api.call('GET', `/stats?from=${DATE}&to=${DATE}`)).body
assert.equal(dayStats.days.length, 1)
assert.equal(dayStats.days[0].done, 4, 'one wash, shower, lunch, duolingo')
assert.equal(dayStats.days[0].stored, true)
assert.equal(dayStats.vocab.daysMet, 0, 'the vocabulary session was deleted')
assert.equal(dayStats.duolingo.lessons, 1)
assert.equal(dayStats.rope.sets, 2)
assert.equal(dayStats.pullup.sets, 1)
assert.equal(dayStats.equipment.reps, 30)
assert.equal(dayStats.washing.pieces, 3)
assert.equal(dayStats.meals.spend, 12.5)
assert.equal(dayStats.runs.count, 0, 'the running entry was cleared')

// The clock is pinned, so completions land inside this same range with no
// conditional range widening.
const stats = (await api.call('GET', `/stats?from=${DATE}&to=${DATE}`)).body
assert.equal(stats.tasks.done, 1, 'one task was completed inside the range')
assert.equal(stats.tasks.doneLate, 1, 'and it was already overdue when finished')
assert.equal(stats.media.films + stats.media.books, 0, 'the book was hard-deleted')

const reversed = await api.call('GET', `/stats?from=${DATE}&to=2020-01-01`)
assert.equal(reversed.status, 400, 'a reversed range is refused')
const tooLong = await api.call('GET', `/stats?from=2000-01-01&to=${DATE}`)
assert.equal(tooLong.status, 400)
assert.equal(tooLong.body.error.code, 'habit/range-too-large')
console.log('statistics ✓  (the whole panel over HTTP, and its range guards)')

// --- failure shapes ----------------------------------------------------------
const unknown = await api.call('GET', '/nope')
assert.equal(unknown.status, 404)
assert.equal(unknown.body.error.code, 'habit/unknown-route')
const badBody = await api.call('PUT', '/meal', { date: DATE, slot: 'brunch' })
assert.equal(badBody.status, 400)
assert.equal(badBody.body.error.code, 'habit/bad-request')
console.log('failures ✓  (uniform { error: { code, message } })')

// --- carry-forward of the target ---------------------------------------------
const next = await api.call('GET', '/state?date=2026-09-17')
assert.deepEqual(next.body.day.target, { new: 10, review: 5 }, 'a new day inherits the last snapshot')
assert.equal(next.body.day.day, null, 'inheriting does not create a document')
console.log('carry-forward ✓  (inherited target, still no document)')

// --- materials, images and focus sessions ------------------------------------
// The image is the subject of the rest of this file: it has to survive the
// restart, land on disk as its own document, and come back through a backup
// into a root that never saw it.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const withImage = await api.call('POST', '/asset', {
  kind: 'task', id: lateId, mime: 'image/png', data: TINY_PNG, name: '讲义.png',
})
assert.equal(withImage.status, 200)
const imageMaterial = withImage.body.entry.materials[0]
assert.equal(imageMaterial.kind, 'image')
assert.equal(imageMaterial.mime, 'image/png', 'mime is derived from the asset document')
assert.equal(imageMaterial.bytes, Buffer.from(TINY_PNG, 'base64').length, 'and so is its size')

const fetched = await api.raw('GET', `/asset?id=${imageMaterial.assetId}`)
assert.equal(fetched.status, 200)
assert.equal(fetched.contentType, 'image/png', 'the bytes come back with their stored mime')
assert.deepEqual(fetched.bytes, Buffer.from(TINY_PNG, 'base64'), 'and they are the bytes that were sent')

const withText = await api.call('POST', '/material', { kind: 'task', id: lateId, text: '## 要点\n- 一条' })
const textMaterial = withText.body.entry.materials.find(material => material.kind === 'md')
assert.equal(textMaterial.text, '## 要点\n- 一条', 'text and images share one ordered stream')
assert.equal(withText.body.entry.materials.length, 2)

const focused = await api.call('POST', '/focus', { kind: 'task', id: lateId })
assert.equal(typeof focused.body.sessionId, 'string', 'the opened session is named back')
assert.equal(focused.body.entry.focusSessions.length, 1)
const closed = await api.call('PATCH', '/focus', {
  kind: 'task', id: lateId, sessionId: focused.body.sessionId,
})
assert.equal(typeof closed.body.entry.focusSessions[0].endedAt, 'string', 'closing stamps the end')
assert.equal(closed.body.entry.focusSeconds, 0, 'the pinned clock makes the session zero-length')
console.log('materials + focus ✓  (image bytes over their own route, one ordered stream, instants only)')

// The answer a focus-mode progress bar gets. Its *shape* is the subject here,
// not the change: the entry has to be the view — the image material carrying the
// mime and size its asset gives it, the task carrying its derived state and
// focus total. Answering the stored record instead is what once made the overlay
// draw its own images as "missing" the moment the bar was dragged.
const writeAnswer = await api.call('PATCH', '/tasks', { id: lateId, patch: { progress: { current: 1 } } })
assert.equal(writeAnswer.status, 200)
const writeEntry = writeAnswer.body.entry
const writeImage = writeEntry.materials.find(material => material.kind === 'image')
assert.equal(writeImage.mime, 'image/png', 'a registry write answers with the material view')
assert.equal(writeImage.bytes, Buffer.from(TINY_PNG, 'base64').length, 'and its derived size')
assert.equal(writeEntry.focusSeconds, 0, 'and the entry\'s derived focus total')
assert.equal(writeEntry.state, 'done', 'and its derived task state')
console.log('the registry write answer ✓  (the entry view, not the stored record)')

// --- a version 1 document is still read --------------------------------------
// The domain moved to version 2 (assets, materials, focusSessions). A
// `per-record` backend *discards* a document stamped with a version it does not
// accept — so this writes one by hand, exactly as the previous build left it,
// and proves `compatibleVersions` is what keeps a year of habit days alive.
const LEGACY_ROOT = join('.tmp', 'verify-host-legacy')
await rm(LEGACY_ROOT, { recursive: true, force: true })
await mkdir(join(LEGACY_ROOT, 'habit', 'days'), { recursive: true })
await writeFile(
  join(LEGACY_ROOT, 'habit', 'days', `${DATE}.json`),
  JSON.stringify({ version: 1, record: { date: DATE, washes: { times: ['2026-09-16T07:00:00.000Z'] } } }),
  'utf8',
)
const legacy = await mount(LEGACY_ROOT)
const legacyDay = await legacy.call('GET', `/state?date=${DATE}`)
assert.equal(legacyDay.status, 200)
assert.equal(legacyDay.body.day.day.washes.times.length, 1, 'a version 1 document is read, not discarded')
assert.deepEqual(legacyDay.body.day.progress, { done: 1, total: 8 }, 'and every derived value is recomputed')
assert.equal(legacyDay.body.tasks.length, 0, 'its records read as having no materials, not as broken')
await legacy.stop()
await rm(LEGACY_ROOT, { recursive: true, force: true })
console.log('legacy data ✓  (a version 1 document survives the version 2 schema)')

// --- on-disk shape -----------------------------------------------------------
const dayFile = join(ROOT, 'habit', 'days', `${DATE}.json`)
const stored = JSON.parse(await readFile(dayFile, 'utf8'))
assert.equal(stored.version, 2, 'records are stamped with the current domain version')
assert.equal(stored.record.date, DATE)
assert.equal(stored.record.washing.length, 1)

// The image is its own document, and its size is nowhere in it.
const assetFile = JSON.parse(await readFile(join(ROOT, 'habit', 'assets', `${imageMaterial.assetId}.json`), 'utf8'))
assert.equal(assetFile.version, 2)
assert.equal(assetFile.record.mime, 'image/png')
assert.equal(assetFile.record.data, TINY_PNG, 'the bytes are the only thing stored about an image')
assert.equal('bytes' in assetFile.record, false, 'a size would be a second copy of the same fact')
let untouchedExists = true
try {
  await readFile(join(ROOT, 'habit', 'days', '2026-09-17.json'), 'utf8')
} catch {
  untouchedExists = false
}
assert.equal(untouchedExists, false, 'an inherited day stays out of the medium')
console.log(`on disk ✓  (habit/days/${DATE}.json is one readable versioned record)`)

// --- restart: re-open the same root -----------------------------------------
await api.stop()
const restarted = await mount()
const reloaded = await restarted.call('GET', `/state?date=${DATE}`)
assert.equal(reloaded.body.day.day.washes.times.length, 1, 'checks survive a restart')
assert.equal(clockOf(reloaded.body.day.day.washes.times[0]), '12:00', 'and the pinned instant they were stamped with')
assert.deepEqual(reloaded.body.day.target, { new: 10, review: 5 })
assert.equal(reloaded.body.stock.pending, 2, 'the laundry stock survives a restart')
assert.equal(reloaded.body.tasks.length, 2, 'tasks survive a restart')
assert.equal(
  reloaded.body.tasks.find(entry => entry.id === lateId).state, 'done',
  'and their derived state is recomputed on read',
)
const reloadedTask = reloaded.body.tasks.find(entry => entry.id === lateId)
assert.equal(reloadedTask.materials.length, 2, 'materials survive a restart')
assert.equal(reloadedTask.focusSessions.length, 1, 'and so do focus sessions')
const afterRestart = await restarted.raw('GET', `/asset?id=${imageMaterial.assetId}`)
assert.deepEqual(afterRestart.bytes, Buffer.from(TINY_PNG, 'base64'), 'the image is still served after a restart')
assert.equal(afterRestart.contentType, 'image/png')
await restarted.stop()
console.log('restart ✓  (everything re-read from the medium, images included)')

// --- backup: export, then restore the file into a fresh root ------------------
const BACKUP_ROOT = join('.tmp', 'verify-host-backup')
await rm(BACKUP_ROOT, { recursive: true, force: true })
await mkdir(BACKUP_ROOT, { recursive: true })

const source = await mount()
const backup = (await source.call('GET', '/backup')).body.backup
assert.equal(backup.format, 'personal-track/backup')
assert.equal(backup.version, 2)
assert.equal(backup.days.length, 1, 'the saved day is in the backup')
assert.equal(backup.days[0].date, DATE)
assert.equal(backup.tasks.length, 2)
assert.equal(backup.media.length, 0, 'the hard-deleted book is not in the backup')
assert.equal(backup.counters.laundry.pending, 2, 'the laundry stock travels with the file')
assert.equal(backup.assets.length, 1, 'and so do the material images')
assert.equal(backup.assets[0].data, TINY_PNG, 'as bytes, since they are the fact')
// The file holds facts only — the derived-state rule reaches the file format.
assert.equal('cells' in backup.days[0], false, 'no derived cell list in a backup')
assert.equal('progress' in backup.days[0], false, 'no derived progress in a backup')
assert.equal(backup.days[0].vocab.ratio, undefined, 'no weighted ratio in a backup')
assert.equal(backup.tasks[0].state, undefined, 'task state is derived, never stored')
assert.equal(
  backup.tasks.find(task => task.id === lateId).focusSeconds, undefined,
  'focus time is derived from the sessions, never stored',
)
await source.stop()

// Restoring into an empty root proves the file alone rebuilds the state.
const restored = await mount(BACKUP_ROOT)
const applied = await restored.call('POST', '/backup', { mode: 'replace', backup })
assert.equal(applied.status, 200)
assert.equal(applied.body.report.days, 1)
assert.equal(applied.body.report.assets, 1, 'the image travelled with the file')
assert.equal(applied.body.report.removed, 0, 'an empty root had nothing to replace')
assert.equal(applied.body.stock.pending, 2, 'the imported stock is live')
const restoredDay = (await restored.call('GET', `/state?date=${DATE}`)).body
assert.equal(restoredDay.day.day.washes.times.length, 1)
assert.equal(restoredDay.day.progress.done, 4, 'every cell is recomputed from the records')
assert.equal(restoredDay.day.vocab.ratio, 0, 'progress is recomputed, not read from the file')
assert.deepEqual(restoredDay.day.target, { new: 10, review: 5 }, 'the target snapshot survives')
assert.equal(restoredDay.tasks.find(task => task.id === lateId)?.state, 'done', 'derived task state comes back')

// The image's bytes came back with the file: a material is only a reference,
// so a restore that lost them would have to say so rather than draw nothing.
const restoredImage = await restored.raw('GET', `/asset?id=${imageMaterial.assetId}`)
assert.equal(restoredImage.status, 200, 'the restored image is served')
assert.deepEqual(restoredImage.bytes, Buffer.from(TINY_PNG, 'base64'), 'byte for byte')
const restoredTask = (await restored.call('GET', `/state?date=${DATE}`)).body.tasks.find(task => task.id === lateId)
assert.equal(restoredTask.materials.length, 2, 'both materials came back, in order')
assert.equal(restoredTask.materials[0].bytes, Buffer.from(TINY_PNG, 'base64').length, 'with their size derived again')

// A restored day is a normal day: it takes new records and reports them.
await restored.call('PUT', '/meal', { date: DATE, slot: 'breakfast', price: 3.5 })
const restoredStats = (await restored.call('GET', `/stats?from=${DATE}&to=${DATE}`)).body
assert.equal(restoredStats.meals.breakfast.days, 1, 'breakfast is projected once recorded')
assert.equal(restoredStats.meals.breakfast.ratio, 1)
assert.equal(restoredStats.meals.spend, 16, 'restored lunch plus the new breakfast')

// `replace` also drops what the file does not carry; `merge` never does.
await restored.call('POST', '/tasks', { title: '临时任务' })
const pruned = await restored.call('POST', '/backup', { mode: 'replace', backup })
assert.equal(pruned.body.report.removed, 1, 'replace cleared the task the file omits')
assert.equal((await restored.call('GET', `/state?date=${DATE}`)).body.tasks.length, 2)
const merged = await restored.call('POST', '/backup', { mode: 'merge', backup: { ...backup, counters: {} } })
assert.equal(merged.body.report.removed, 0, 'merge drops nothing')
assert.equal(merged.body.stock.pending, 2, 'and leaves a counter the file omits alone')

// A file that is not ours is refused whole, and changes nothing.
const refused = await restored.call('POST', '/backup', { mode: 'merge', backup: { hello: 'world' } })
assert.equal(refused.status, 400)
assert.equal(refused.body.error.code, 'habit/bad-backup')
const corrupted = await restored.call('POST', '/backup', {
  mode: 'merge',
  backup: { ...backup, days: [{ ...backup.days[0], washes: { times: 'nope' } }] },
})
assert.equal(corrupted.status, 400, 'one bad record fails the whole file')
assert.equal(corrupted.body.error.code, 'habit/bad-backup')
assert.equal((await restored.call('GET', `/state?date=${DATE}`)).body.tasks.length, 2, 'a refused import wrote nothing')
const badVersion = await restored.call('POST', '/backup', { mode: 'merge', backup: { ...backup, version: 99 } })
assert.equal(badVersion.status, 400)
assert.match(badVersion.body.error.message, /版本/)

// A version 1 file is still readable. What makes one is not only the number:
// the previous build had no materials and no assets, so the records carry
// neither — a file with image materials and no bytes is refused just below.
const legacyBackup = {
  ...backup,
  version: 1,
  assets: [],
  media: backup.media.map(({ materials, focusSessions, ...rest }) => rest),
  tasks: backup.tasks.map(({ materials, focusSessions, ...rest }) => rest),
}
const fromLegacy = await restored.call('POST', '/backup', { mode: 'merge', backup: legacyBackup })
assert.equal(fromLegacy.status, 200, 'a version 1 file is accepted')
assert.equal(fromLegacy.body.report.assets, 0, 'and reports no images, because it carries none')

// A material is a reference; a file whose bytes are missing is refused whole
// rather than silently imported as an entry with a broken picture.
const dangling = await restored.call('POST', '/backup', {
  mode: 'merge',
  backup: { ...backup, assets: [] },
})
assert.equal(dangling.status, 400, 'an image material with no bytes fails the whole file')
assert.equal(dangling.body.error.code, 'habit/bad-backup')
assert.match(dangling.body.error.message, /图片素材缺少对应数据/)

// An import really replaces the counter table when the file omits it.
const noCounter = await restored.call('POST', '/backup', { mode: 'replace', backup: { ...backup, counters: {} } })
assert.equal(noCounter.body.report.removed, 1, 'the laundry counter was dropped')
assert.equal(noCounter.body.stock.pending, 0, 'and reads as zero afterwards')
await restored.stop()
await rm(BACKUP_ROOT, { recursive: true, force: true })
console.log('backup ✓  (facts-only file, restore into a fresh root, merge vs replace, bad files refused)')

await rm(ROOT, { recursive: true, force: true })
console.log('\nhost half ✓  full API round-trip against real storage')
