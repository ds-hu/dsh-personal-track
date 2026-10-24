/**
 * One handler per route, keyed by the shared route table.
 *
 * These implementations were previously the arms of a single `switch` inside
 * `createApiHandler`, sharing one very wide closure. Splitting them out changes
 * no rule; it changes what is testable. Each handler receives a {@link RouteCtx}
 * of resolved dependencies and **returns the response body**, so the transport —
 * reading a body, writing JSON, mapping a failure to a status — lives in exactly
 * one place (`api.ts`) instead of being interleaved with the domain rules.
 *
 * The table is typed `Record<RouteName, RouteHandler>`, so a route declared in
 * `src/shared/route.ts` with no handler here is a compile error, and the
 * constructor additionally checks the two sets agree at runtime.
 */
import { z } from 'zod'
import { BackupFormatError, type Backup, type ImportMode } from './backup.ts'
import type { Config, DayBoundary } from './config.ts'
import { dayKeySpan, isNightTail, type DayKey } from '../shared/habit-day.ts'
import { CHECK_HABITS, MEAL_SLOTS } from './habits.ts'
import { mediaRecord, taskRecord } from './domain.ts'
import { ApiError } from './api-error.ts'
import { buildStats } from './stats.ts'
import {
  base64Bytes,
  type HabitStore,
  type SessionKind,
  type StateView,
} from './store.ts'
import type { RouteName } from '../shared/route.ts'
import { MAX_IMAGE_BYTES } from '../shared/route.ts'

/** Everything a handler needs from the plugin, already resolved. */
export interface RouteCtx {
  readonly store: HabitStore
  readonly backup: Backup
  readonly boundary: DayBoundary
  readonly config: Config
  readonly now: () => Date
  /** The current instant, ISO-encoded. */
  readonly iso: () => string
  /** The current habit day. */
  readonly today: () => DayKey
  /** The state slice every mutation answers with. */
  readonly stateFor: (date: DayKey) => StateAnswer
  /** Parse with zod, or fail as a 400. */
  readonly parse: <T extends z.ZodType>(schema: T, value: unknown, what: string) => z.infer<T>
  /** Date from body/query, else the current habit day. */
  readonly dateOf: (source: { date?: unknown }, fallback: DayKey) => DayKey
  /** Turn a `time` into an instant inside the habit day. */
  readonly resolveAt: (source: Record<string, unknown>, date: DayKey) => Record<string, unknown>
  /** Resolve a raw entry's `time`/`at` to an instant, or undefined for "now". */
  readonly entryInstant: (rawEntry: Record<string, unknown>, date: DayKey) => string | undefined
}

/** A body to answer with; the transport decides the status line. */
export type RouteResult = Record<string, unknown> | StateAnswer | BinaryResult

/**
 * A route that answers with bytes instead of a JSON body.
 *
 * The marker is part of the result type rather than a side channel, so `asset`
 * stays an ordinary entry in the handler table — which is what keeps the
 * "declared routes == implemented routes" invariant whole — and the transport
 * remains the only layer that knows how to write one.
 */
export interface BinaryResult {
  readonly binary: {
    readonly contentType: string
    /** Base64 payload; the transport decodes it into the response body. */
    readonly base64: string
    /** How long a browser may keep it. Assets are immutable per id. */
    readonly cacheSeconds: number
  }
}

/**
 * One route's implementation.
 *
 * @param ctx - the resolved dependencies.
 * @param body - the parsed request body (`{}` when the request carried none).
 * @param query - the query parameters.
 * @returns the JSON body to write with a 200.
 */
export type RouteHandler = (
  ctx: RouteCtx,
  body: Record<string, unknown>,
  query: Record<string, string>,
) => Promise<RouteResult>

/** A backup file is far larger than an ordinary mutation body. */
export const BACKUP_BODY_LIMIT = 16 * 1024 * 1024

/**
 * One image, base64-encoded. Sized from the wire constant the browser half also
 * enforces, plus the JSON framing a request adds around it.
 */
export const ASSET_BODY_LIMIT = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64 * 1024

/** One Markdown block is text, but a long note still dwarfs a mutation body. */
export const MATERIAL_BODY_LIMIT = 512 * 1024

/** The longest single Markdown block the plugin stores, in characters. */
export const MAX_MATERIAL_CHARS = 64 * 1024

/** Which registry entry a material or focus request addresses. */
const ownerTarget = z.object({
  kind: z.enum(['task', 'media']),
  id: z.string().min(1),
})

/**
 * One image's base64 payload: base64 by shape, bounded by the wire cap.
 *
 * The cap is checked on the **decoded** byte count, because that is the number
 * the browser half measured against the same constant — and because an encoded
 * length is up to three bytes coarser than the payload it carries, so a limit
 * compared against the string would let a payload of `MAX + 1` bytes through.
 */
const imageData = z.string().min(1).refine(
  (value) => /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0,
  'data must be base64',
).refine(
  (value) => base64Bytes(value) <= MAX_IMAGE_BYTES,
  '图片超过上限',
)

/** The one shape a write answers with: `ok` plus the **习惯日** slice. */
export type StateAnswer = StateView & { readonly ok: true }

/**
 * One write's answer: the **习惯日** slice it was addressed with, plus extras.
 *
 * Every mutation in this table answers this way — one shape, one adoption path
 * on the client — and a write that changes a registry entry additionally names
 * the entry it changed.
 *
 * The day is the caller's **viewpoint**, not necessarily today: a registry entry
 * belongs to no habit day, but the answer is the slice of the day the client is
 * looking at, so it can adopt it without a second read. The slice is read once
 * and the entry is carved out of it, so two fields of one response can never
 * disagree about what was just written.
 *
 * The entry is the view and never the stored record. A record carries neither
 * the mime nor the byte size of an image material — both are derived from the
 * asset table — nor the derived `focusSeconds`/`state` a task shows, so a
 * client that adopts a record as its entry renders every image on that entry as
 * missing and its focus time as no time at all. That is not hypothetical: it is
 * what dragging focus mode's progress bar used to do.
 */
function writeAnswer(
  ctx: RouteCtx,
  date: DayKey,
  changed?: { readonly kind: 'task' | 'media'; readonly id: string },
): Record<string, unknown> {
  const answer = ctx.stateFor(date)
  if (changed === undefined) return { ...answer }
  const entry = changed.kind === 'task'
    ? answer.tasks.find(candidate => candidate.id === changed.id)
    : answer.media.find(candidate => candidate.id === changed.id)
  return { ...answer, entry }
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
const ISO = z.string().min(1)
/** The meal **槽位** the wire accepts, named by the habit inventory. */
const SLOT = z.enum(MEAL_SLOTS)
/** The habits a **打卡** addresses, named by the same inventory. */
const CHECKED = z.enum(CHECK_HABITS)

/**
 * A write's **viewpoint**: which habit day its answer should describe.
 *
 * A **登记** entry belongs to no habit day, so a registry write is not addressed
 * to one — but its answer is a state slice, and the client is showing *a day*.
 * Sending that day up means every write answers the thing the caller can adopt
 * without a second read (docs/adr/0004-write-answers-the-day-slice.md). Absent
 * means today, which is what a caller that does not care about the viewpoint
 * gets.
 */
const VIEWPOINT = { date: DATE.optional() }

/** Per-kind session entry schemas; `at` is stamped by the server when absent. */
const sessionSchemas = {
  vocab: z.object({
    at: ISO.optional(),
    new: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    minutes: z.number().nonnegative(),
  }),
  duolingo: z.object({ at: ISO.optional(), minutes: z.number().nonnegative() }),
  rope: z.object({
    at: ISO.optional(),
    preset: z.union([z.literal(90), z.literal(180)]),
    seconds: z.number().nonnegative(),
    avgHr: z.number().int().positive().optional(),
  }),
  pullup: z.object({ at: ISO.optional(), seconds: z.number().nonnegative() }),
  plank: z.object({ at: ISO.optional(), seconds: z.number().nonnegative() }),
  equipment: z.object({
    at: ISO.optional(),
    name: z.string().min(1),
    reps: z.number().int().nonnegative(),
    weight: z.number().nonnegative().optional(),
  }),
  washing: z.object({ at: ISO.optional(), pieces: z.number().int().positive() }),
} satisfies Record<SessionKind, z.ZodType>

/** Narrow a string to a session kind. */
function asSessionKind(value: unknown): SessionKind {
  if (typeof value === 'string' && value in sessionSchemas) return value as SessionKind
  throw new ApiError(400, 'habit/bad-request', `unknown session kind: ${String(value)}`)
}

/**
 * The `kind`, the habit day, and the entry a session request describes.
 *
 * A clock time reaches these routes in one of three shapes, and only the host
 * may resolve any of them, because a time before the boundary belongs to the
 * night tail of the previous habit day:
 *
 * - `entry.time` — creating a session at a known hour;
 * - `time`, beside `patch` — retiming from a caller that keeps the two apart;
 * - `patch.time` — what the board's own editor form actually sends, because its
 *   time input is just another field in the payload.
 *
 * All three collapse into the entry's `time`, which {@link RouteCtx.entryInstant}
 * resolves. `at` is deliberately not hoisted: it is the entry's own field, and
 * an outer one must not shadow the instant already stored.
 */
function sessionRequest(body: Record<string, unknown>, ctx: RouteCtx): {
  kind: SessionKind
  date: DayKey
  rawEntry: Record<string, unknown>
  patch: Record<string, unknown>
} {
  const kind = asSessionKind(body.kind)
  const date = ctx.dateOf(body, ctx.today())
  const outer = (body.patch ?? {}) as Record<string, unknown>
  const { time: outerTime, ...restOuter } = outer
  const entry = (body.entry ?? {}) as Record<string, unknown>
  const clock = body.time ?? outerTime ?? entry.time
  const rawEntry: Record<string, unknown> = { time: clock, ...entry }
  // The clock is not a metric, so it must not survive into the patch object and
  // be stripped by the schema as an unknown key.
  return { kind, date, rawEntry, patch: restOuter }
}

export const handlers: Record<RouteName, RouteHandler> = {
  // --- reads ---------------------------------------------------------------

  async clock(ctx) {
    const now = ctx.now()
    return {
      ok: true,
      today: ctx.today(),
      nightTail: isNightTail(now, ctx.boundary),
      now: now.toISOString(),
      config: {
        dayStartHour: ctx.config.dayStartHour,
        defaultVocabTarget: ctx.config.defaultVocabTarget,
        defaultRunMinutes: ctx.config.defaultRunMinutes,
      },
    }
  },

  async state(ctx, _body, query) {
    return ctx.stateFor(ctx.dateOf(query, ctx.today()))
  },

  async stats(ctx, _body, query) {
    const range = ctx.parse(z.object({ from: DATE.optional(), to: DATE.optional() }), query, 'stats range')
    const to = range.to ?? ctx.today()
    const from = range.from ?? to
    if (from > to) throw new ApiError(400, 'habit/bad-request', 'from 必须不晚于 to')
    if (dayKeySpan(from, to, 401) > 400) {
      throw new ApiError(400, 'habit/range-too-large', '统计范围最多 400 天')
    }
    return { ok: true, ...buildStats(ctx.store, from, to, ctx.boundary) }
  },

  // --- counted checks ------------------------------------------------------

  async check(ctx, body) {
    const raw = ctx.parse(z.object({
      date: DATE.optional(),
      habit: CHECKED,
      /** Optional clock time, for backfilling at a known hour. */
      time: z.string().optional(),
      at: ISO.optional(),
    }), body, 'check')
    const date = ctx.dateOf(raw, ctx.today())
    const resolved = ctx.resolveAt(raw, date)
    const at = typeof resolved.at === 'string' ? resolved.at : ctx.iso()
    // The daily cap, the default index and "no such check" all live inside the
    // store's atomic write; the route only resolves the day and the instant.
    await ctx.store.addCheck(date, raw.habit, at)
    return ctx.stateFor(date)
  },

  async editCheck(ctx, body) {
    const raw = ctx.parse(z.object({
      date: DATE.optional(),
      habit: CHECKED,
      /** Which recorded check to retime; defaults to the most recent. */
      index: z.number().int().nonnegative().optional(),
      time: z.string().optional(),
      at: ISO.optional(),
    }), body, 'check edit')
    const date = ctx.dateOf(raw, ctx.today())
    const resolved = ctx.resolveAt(raw, date)
    const at = resolved.at
    if (typeof at !== 'string') throw new ApiError(400, 'habit/bad-request', '需要 time 或 at')
    // Which record to retime — and whether it exists at all — is the store's
    // decision, taken inside the same atomic write that applies the new instant.
    await ctx.store.retimeCheck(date, raw.habit, at, raw.index)
    return ctx.stateFor(date)
  },

  async uncheck(ctx, _body, query) {
    const body = ctx.parse(z.object({
      date: DATE.optional(),
      habit: CHECKED,
      /** Which recorded check to drop; defaults to the most recent one. */
      index: z.coerce.number().int().nonnegative().optional(),
    }), query, 'check')
    const date = ctx.dateOf(body, ctx.today())
    // Removing a check that is already gone is not a fault (a second click, or
    // the same delete from two windows), so this answers 200 either way.
    await ctx.store.removeCheck(date, body.habit, body.index)
    return ctx.stateFor(date)
  },

  // --- meal slots ----------------------------------------------------------

  async setMeal(ctx, body) {
    const raw = ctx.parse(z.object({
      date: DATE.optional(),
      slot: SLOT,
      /** Optional clock time; absent means "now". */
      time: z.string().optional(),
      at: ISO.optional(),
      price: z.number().nonnegative().optional(),
    }), body, 'meal')
    const date = ctx.dateOf(raw, ctx.today())
    const resolved = ctx.resolveAt(raw, date)
    const meal = {
      at: typeof resolved.at === 'string' ? resolved.at : ctx.iso(),
      ...(resolved.price === undefined ? {} : { price: resolved.price }),
    }
    await ctx.store.mutateDay(date, day => ({ ...day, meals: { ...day.meals, [raw.slot]: meal } }))
    return ctx.stateFor(date)
  },

  async clearMeal(ctx, _body, query) {
    const body = ctx.parse(z.object({ date: DATE.optional(), slot: SLOT }), query, 'meal')
    const date = ctx.dateOf(body, ctx.today())
    await ctx.store.mutateDay(date, (day) => {
      const meals = { ...day.meals }
      delete meals[body.slot]
      return { ...day, meals }
    })
    return ctx.stateFor(date)
  },

  // --- sessions ------------------------------------------------------------

  async addSession(ctx, body) {
    const { kind, date, rawEntry } = sessionRequest(body, ctx)
    const entry = ctx.parse(sessionSchemas[kind], body.entry, `session ${kind}`) as Record<string, unknown>
    await ctx.store.addSession(date, kind, { ...entry, at: ctx.entryInstant(rawEntry, date) ?? ctx.iso() })
    return ctx.stateFor(date)
  },

  async patchSession(ctx, body) {
    const { kind, date, rawEntry, patch: rawPatch } = sessionRequest(body, ctx)
    const id = ctx.parse(z.object({ id: z.string().min(1) }), body, 'session').id
    const patch = ctx.parse(sessionSchemas[kind].partial(), rawPatch, `session ${kind}`) as Record<string, unknown>
    const instant = ctx.entryInstant(rawEntry, date)
    await ctx.store.patchSession(date, kind, id, instant === undefined ? patch : { ...patch, at: instant })
    return ctx.stateFor(date)
  },

  async removeSession(ctx, _body, query) {
    const body = ctx.parse(z.object({
      date: DATE.optional(),
      kind: z.string(),
      id: z.string().min(1),
    }), query, 'session')
    const kind = asSessionKind(body.kind)
    const date = ctx.dateOf(body, ctx.today())
    await ctx.store.removeSession(date, kind, body.id)
    return ctx.stateFor(date)
  },

  // --- running -------------------------------------------------------------

  async setRun(ctx, body) {
    const raw = ctx.parse(z.object({
      date: DATE.optional(),
      /** Optional clock time; absent means "now". */
      time: z.string().optional(),
      at: ISO.optional(),
      minutes: z.number().positive().optional(),
      distanceKm: z.number().nonnegative(),
      avgHr: z.number().int().positive().optional(),
    }), body, 'run')
    const date = ctx.dateOf(raw, ctx.today())
    const resolved = ctx.resolveAt(raw, date)
    const run = {
      at: typeof resolved.at === 'string' ? resolved.at : ctx.iso(),
      minutes: raw.minutes ?? ctx.config.defaultRunMinutes,
      distanceKm: raw.distanceKm,
      ...(raw.avgHr === undefined ? {} : { avgHr: raw.avgHr }),
    }
    await ctx.store.mutateDay(date, day => ({ ...day, run }))
    return ctx.stateFor(date)
  },

  async clearRun(ctx, _body, query) {
    const body = ctx.parse(z.object({ date: DATE.optional() }), query, 'run')
    const date = ctx.dateOf(body, ctx.today())
    await ctx.store.mutateDay(date, day => ({ ...day, run: null }))
    return ctx.stateFor(date)
  },

  // --- vocabulary target ---------------------------------------------------

  async setVocabTarget(ctx, body) {
    const parsed = ctx.parse(z.object({
      date: DATE.optional(),
      new: z.number().int().nonnegative(),
      review: z.number().int().nonnegative(),
    }), body, 'vocab-target')
    const date = ctx.dateOf(parsed, ctx.today())
    await ctx.store.setVocabTarget(date, { new: parsed.new, review: parsed.review })
    return ctx.stateFor(date)
  },

  // --- the laundry pair ----------------------------------------------------

  async laundryWash(ctx, body) {
    const raw = ctx.parse(z.object({
      date: DATE.optional(),
      pieces: z.number().int().positive(),
      /** Optional clock time; absent means "now". */
      time: z.string().optional(),
      at: ISO.optional(),
    }), body, 'laundry wash')
    const date = ctx.dateOf(raw, ctx.today())
    const resolved = ctx.resolveAt(raw, date)
    const { stock } = await ctx.store.wash(date, raw.pieces, typeof resolved.at === 'string' ? resolved.at : ctx.iso())
    return { ...ctx.stateFor(date), stock }
  },

  async laundryStock(ctx, body) {
    const raw = ctx.parse(z.object({
      pending: z.number().int().nonnegative(),
      at: ISO.optional(),
      ...VIEWPOINT,
    }), body, 'laundry stock')
    const date = ctx.dateOf(raw, ctx.today())
    const stock = await ctx.store.setStock(raw.pending, raw.at ?? ctx.iso())
    return { ...ctx.stateFor(date), stock }
  },

  // --- backup --------------------------------------------------------------

  async exportBackup(ctx) {
    return { ok: true, backup: ctx.backup.exportAll(ctx.iso()) }
  },

  async importBackup(ctx, body) {
    const parsed = ctx.parse(z.object({
      /** `merge` overwrites the keys the file carries; `replace` also
       *  drops everything the file does not carry. */
      mode: z.enum(['merge', 'replace']).default('merge'),
      backup: z.unknown(),
      ...VIEWPOINT,
    }), body, 'backup import')
    const date = ctx.dateOf(parsed, ctx.today())
    let report
    try {
      report = await ctx.backup.importAll(parsed.backup, parsed.mode as ImportMode)
    } catch (cause) {
      // A file that is not a readable backup is a client error, and it carries
      // its own wording (identity, version, or the offending field).
      if (cause instanceof BackupFormatError) throw new ApiError(400, 'habit/bad-backup', cause.message)
      throw cause
    }
    return { ...writeAnswer(ctx, date), report }
  },

  // --- media ---------------------------------------------------------------

  async addMedia(ctx, body) {
    const date = ctx.dateOf(body, ctx.today())
    const raw = ctx.parse(mediaRecord.omit({ id: true, createdAt: true, status: true }).extend({
      status: mediaRecord.shape.status.optional(),
    }), body, 'media')
    const record = mediaRecord.parse({
      ...raw,
      id: ctx.store.newId(),
      status: raw.status ?? 'active',
      createdAt: ctx.iso(),
    })
    await ctx.store.putMedia(record)
    return writeAnswer(ctx, date, { kind: 'media', id: record.id })
  },

  async patchMedia(ctx, body) {
    const date = ctx.dateOf(body, ctx.today())
    const outer = ctx.parse(z.object({ id: z.string().min(1), patch: z.unknown() }), body, 'media patch')
    // `null` clears an optional field; an absent key leaves it alone.
    const patch = ctx.parse(z.object({
      kind: z.enum(['film', 'book']).optional(),
      title: z.string().min(1).optional(),
      status: z.enum(['active', 'done', 'dropped']).optional(),
      rating: z.number().int().min(1).max(5).nullable().optional(),
      startedAt: z.string().nullable().optional(),
      finishedAt: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    }), outer.patch, 'media patch')
    const entry = await ctx.store.patchMedia(outer.id, patch)
    return writeAnswer(ctx, date, { kind: 'media', id: entry.id })
  },

  async removeMedia(ctx, _body, query) {
    const body = ctx.parse(z.object({ id: z.string().min(1), ...VIEWPOINT }), query, 'media delete')
    const date = ctx.dateOf(body, ctx.today())
    const removed = await ctx.store.deleteMedia(body.id)
    return { ...writeAnswer(ctx, date), removed }
  },

  // --- tasks ---------------------------------------------------------------

  async addTask(ctx, body) {
    const date = ctx.dateOf(body, ctx.today())
    // Checkpoints travel as content only (`label` + `at`); ids are storage's
    // business, so this half assigns them before the record is parsed.
    const checkpointInput = z.object({
      label: z.string().min(1),
      at: z.number().int().positive(),
    })
    const raw = ctx.parse(taskRecord.omit({ id: true, createdAt: true, checkpoints: true }).partial({
      progress: true, title: true,
    }).extend({
      title: z.string().min(1),
      checkpoints: z.array(checkpointInput).optional(),
    }), body, 'task')
    const record = taskRecord.parse({
      ...raw,
      id: ctx.store.newId(),
      createdAt: ctx.iso(),
      checkpoints: (raw.checkpoints ?? []).map(line => ({ ...line, id: ctx.store.newId() })),
    })
    await ctx.store.putTask(record)
    return writeAnswer(ctx, date, { kind: 'task', id: record.id })
  },

  async patchTask(ctx, body) {
    const date = ctx.dateOf(body, ctx.today())
    const outer = ctx.parse(z.object({ id: z.string().min(1), patch: z.unknown() }), body, 'task patch')
    // `null` clears an optional field; `progress` merges field by field. A
    // checkpoint list replaces wholesale (an empty list clears them all).
    const patch = ctx.parse(z.object({
      title: z.string().min(1).optional(),
      category: z.string().nullable().optional(),
      due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'due must be YYYY-MM-DD').nullable().optional(),
      progress: z.object({
        current: z.number().int().nonnegative().optional(),
        total: z.number().int().positive().nullable().optional(),
      }).optional(),
      checkpoints: z.array(z.object({
        label: z.string().min(1),
        at: z.number().int().positive(),
      })).optional(),
      notes: z.string().nullable().optional(),
    }), outer.patch, 'task patch')
    const entry = await ctx.store.patchTask(outer.id, patch)
    return writeAnswer(ctx, date, { kind: 'task', id: entry.id })
  },

  async removeTask(ctx, _body, query) {
    const body = ctx.parse(z.object({ id: z.string().min(1), ...VIEWPOINT }), query, 'task delete')
    const date = ctx.dateOf(body, ctx.today())
    const removed = await ctx.store.deleteTask(body.id)
    return { ...writeAnswer(ctx, date), removed }
  },

  // --- materials: the ordered text/image stream on a registry entry --------

  async asset(ctx, _body, query) {
    const { id } = ctx.parse(z.object({ id: z.string().min(1) }), query, 'asset')
    const asset = ctx.store.readAsset(id)
    // A missing image is a 404, not an empty body: the `<img>` that asked gets
    // a status it can act on instead of a silently broken picture.
    if (asset === undefined) throw new ApiError(404, 'habit/not-found', 'no such asset')
    return {
      binary: {
        contentType: asset.mime,
        base64: asset.data,
        // Content is immutable per id, so a browser may keep it indefinitely.
        cacheSeconds: 31_536_000,
      },
    }
  },

  async addAsset(ctx, body) {
    const raw = ctx.parse(ownerTarget.extend({
      ...VIEWPOINT,
      mime: z.string().min(1).max(128),
      data: imageData,
      name: z.string().max(256).optional(),
    }), body, 'asset')
    const date = ctx.dateOf(raw, ctx.today())
    await ctx.store.addMaterialImage(raw.kind, raw.id, {
      mime: raw.mime,
      data: raw.data,
      ...(raw.name === undefined ? {} : { name: raw.name }),
    })
    return writeAnswer(ctx, date, { kind: raw.kind, id: raw.id })
  },

  /**
   * The one write that answers no slice.
   *
   * It reclaims orphaned bytes: no habit day and no entry is changed, so there
   * is nothing for a slice to describe. Answering one anyway would imply the
   * client should re-render a day nothing touched.
   */
  async sweepAssets(ctx) {
    const removed = await ctx.store.sweepOrphanAssets()
    return { ok: true, removed }
  },

  async addMaterial(ctx, body) {
    const raw = ctx.parse(ownerTarget.extend({
      ...VIEWPOINT,
      text: z.string().max(MAX_MATERIAL_CHARS),
    }), body, 'material')
    const date = ctx.dateOf(raw, ctx.today())
    await ctx.store.addMaterialText(raw.kind, raw.id, raw.text)
    return writeAnswer(ctx, date, { kind: raw.kind, id: raw.id })
  },

  async patchMaterial(ctx, body) {
    const raw = ctx.parse(ownerTarget.extend({
      ...VIEWPOINT,
      materialId: z.string().min(1),
      text: z.string().max(MAX_MATERIAL_CHARS),
    }), body, 'material patch')
    const date = ctx.dateOf(raw, ctx.today())
    await ctx.store.patchMaterialText(raw.kind, raw.id, raw.materialId, raw.text)
    return writeAnswer(ctx, date, { kind: raw.kind, id: raw.id })
  },

  async removeMaterial(ctx, _body, query) {
    const raw = ctx.parse(ownerTarget.extend({
      ...VIEWPOINT,
      materialId: z.string().min(1),
    }), query, 'material delete')
    const date = ctx.dateOf(raw, ctx.today())
    await ctx.store.removeMaterial(raw.kind, raw.id, raw.materialId)
    return writeAnswer(ctx, date, { kind: raw.kind, id: raw.id })
  },

  // --- focus sessions: instants only, duration derived ---------------------

  async focusStart(ctx, body) {
    const raw = ctx.parse(ownerTarget.extend(VIEWPOINT), body, 'focus')
    const date = ctx.dateOf(raw, ctx.today())
    const sessionId = await ctx.store.startFocus(raw.kind, raw.id)
    return { ...writeAnswer(ctx, date, { kind: raw.kind, id: raw.id }), sessionId }
  },

  async focusEnd(ctx, body) {
    const raw = ctx.parse(ownerTarget.extend({
      ...VIEWPOINT,
      sessionId: z.string().min(1),
    }), body, 'focus end')
    const date = ctx.dateOf(raw, ctx.today())
    await ctx.store.endFocus(raw.kind, raw.id, raw.sessionId)
    return writeAnswer(ctx, date, { kind: raw.kind, id: raw.id })
  },
}
