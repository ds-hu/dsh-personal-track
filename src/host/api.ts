/**
 * The plugin's own HTTP API, served on `ctx.webServer` under `/habit/api`.
 *
 * Transport rationale: docs/adr/0001-out-of-tree-transport.md. This module is
 * deliberately thin — it reads a body, resolves the route from the shared
 * table, calls one handler, and maps any failure onto one shape:
 * `{ error: { code, message } }`. The rules themselves live in `routes.ts`, and
 * the route names live in `src/shared/route.ts` so the browser half builds its
 * requests from the same declaration.
 *
 * The transport is two interfaces rather than all of `node:http`, which is what
 * makes every route drivable from a test with no socket.
 */
import { z } from 'zod'
import { ApiError } from './api-error.ts'
import type { Backup } from './backup.ts'
import type { Config, DayBoundary } from './config.ts'
import { habitDayKey, instantForHabitDay, type DayKey } from '../shared/habit-day.ts'
import { BACKUP_BODY_LIMIT, ASSET_BODY_LIMIT, MATERIAL_BODY_LIMIT, handlers, type BinaryResult, type RouteCtx, type StateAnswer } from './routes.ts'
import type { HabitStore } from './store.ts'
import { API_PREFIX, routes, type RouteName } from '../shared/route.ts'

export { API_PREFIX } from '../shared/route.ts'
export { ApiError } from './api-error.ts'

/**
 * The transport this handler actually needs — not all of `node:http`.
 *
 * `node:http`'s own types are structurally wider than this (an
 * `IncomingMessage` is async-iterable and a `ServerResponse` writes headers
 * and ends), so the real server still satisfies it. Narrowing the signature is
 * what lets a test drive every route without opening a socket: the whole route
 * matrix, including the failure paths, runs against a request/response double.
 */
export interface HabitRequest {
  readonly method?: string
  readonly url?: string
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>
}

/** The response half of the transport: write a status and a body, nothing more. */
export interface HabitResponse {
  writeHead(status: number, headers: Record<string, string>): unknown
  /** A string for JSON, a `Buffer` for the one route that answers with bytes. */
  end(body?: string | Buffer): unknown
}

/** The handler shape this module produces. */
export type HabitHandler = (req: HabitRequest, res: HabitResponse) => Promise<void>

/** Everything the handler needs from the plugin. */
export interface ApiDeps {
  readonly store: HabitStore
  readonly backup: Backup
  readonly boundary: DayBoundary
  readonly config: Config
  readonly now: () => Date
}

/** A backup file is far larger than an ordinary mutation body. */
const BODY_LIMIT = 64 * 1024

/**
 * Routes whose body legitimately dwarfs a mutation.
 *
 * A single limit for everything would either be too small for one image or
 * absurdly generous for a check-in; naming the exceptions keeps the ordinary
 * path's guard as tight as it was.
 */
const BODY_LIMITS: Partial<Record<RouteName, number>> = {
  importBackup: BACKUP_BODY_LIMIT,
  addAsset: ASSET_BODY_LIMIT,
  addMaterial: MATERIAL_BODY_LIMIT,
  patchMaterial: MATERIAL_BODY_LIMIT,
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')

/** Write one JSON response. */
function sendJson(res: HabitResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Write one byte response.
 *
 * Base64 is decoded here rather than in the handler because *serialization* is
 * this module's job — the handler answers with a payload, the transport decides
 * how a payload becomes a response. Long-lived caching is safe because an
 * asset's id is its content: a material never points at different bytes.
 */
function sendBinary(res: HabitResponse, status: number, result: BinaryResult): void {
  const { contentType, base64, cacheSeconds } = result.binary
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': String(Buffer.from(base64, 'base64').length),
    'cache-control': `private, max-age=${cacheSeconds}, immutable`,
  })
  res.end(Buffer.from(base64, 'base64'))
}

/** Read and parse a JSON body, bounded in size. */
async function readJson(req: HabitRequest, limit = BODY_LIMIT): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) throw new ApiError(413, 'habit/too-large', 'request body too large')
    chunks.push(buffer)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    throw new ApiError(400, 'habit/bad-json', 'request body is not valid JSON')
  }
}

/** The `GET`/`POST`/… half of a route key. */
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/** Find the declared route a request names, or fail as a 404. */
function routeFor(method: string, path: string): RouteName {
  const found = (Object.keys(routes) as RouteName[]).find(
    (name) => {
      const entry = routes[name]
      return entry.method === method && entry.request === path
    },
  )
  if (found === undefined) throw new ApiError(404, 'habit/unknown-route', `no route for ${method} ${path}`)
  return found
}

/**
 * Create the route handler.
 *
 * @param deps - the store, the backup surface, the day boundary, the config and
 *   a clock.
 * @returns a transport-agnostic handler.
 */
export function createApiHandler(deps: ApiDeps): HabitHandler {
  const { store } = deps
  const iso = (): string => deps.now().toISOString()
  const today = (): DayKey => habitDayKey(deps.now(), deps.boundary)

  /** Parse with zod, or fail as a 400. */
  function parse<T extends z.ZodType>(schema: T, value: unknown, what: string): z.infer<T> {
    const result = schema.safeParse(value)
    if (!result.success) {
      const first = result.error.issues[0]
      throw new ApiError(400, 'habit/bad-request', `${what}: ${first?.path.join('.') ?? ''} ${first?.message ?? 'invalid'}`.trim())
    }
    return result.data
  }

  /** Date from body/query, else the current habit day. */
  function dateOf(source: { date?: unknown }, fallback: DayKey): DayKey {
    const value = source.date
    if (value === undefined || value === null || value === '') return fallback
    return parse(DATE, value, 'date')
  }

  /**
   * Turn a clock time into an instant inside the habit day.
   *
   * The board sends `HH:mm`; only the host may decide which calendar day that
   * lands on, because a time before the boundary belongs to the night tail of
   * the previous habit day.
   */
  function resolveAt(source: Record<string, unknown>, date: DayKey): Record<string, unknown> {
    const clock = source.time
    if (typeof clock !== 'string') return source
    const { time: _dropped, ...rest } = source
    try {
      return { ...rest, at: instantForHabitDay(date, clock, deps.boundary) }
    } catch (cause) {
      throw new ApiError(400, 'habit/bad-request', cause instanceof Error ? cause.message : 'invalid time')
    }
  }

  /** Resolve a raw entry's `time`/`at` to an instant, or undefined for "now". */
  function entryInstant(rawEntry: Record<string, unknown>, date: DayKey): string | undefined {
    if (typeof rawEntry.time === 'string') {
      try {
        return instantForHabitDay(date, rawEntry.time, deps.boundary)
      } catch (cause) {
        throw new ApiError(400, 'habit/bad-request', cause instanceof Error ? cause.message : 'invalid time')
      }
    }
    return typeof rawEntry.at === 'string' ? rawEntry.at : undefined
  }

  /** The state slice every mutation answers with. */
  function stateFor(date: DayKey): StateAnswer {
    return { ok: true, ...store.view(date, today()) }
  }

  const ctx: RouteCtx = {
    store,
    backup: deps.backup,
    boundary: deps.boundary,
    config: deps.config,
    now: deps.now,
    iso,
    today,
    stateFor,
    parse,
    dateOf,
    resolveAt,
    entryInstant,
  }

  /**
   * The declared routes and the implemented ones must be the same set.
   *
   * `handlers` is typed `Record<RouteName, …>`, so this cannot fail for a
   * missing entry without a compile error; it is the *extra* direction — a
   * handler with no declaration — that only a runtime check can catch, and a
   * route table that has drifted from reality is exactly the bug this table
   * exists to prevent.
   */
  const declared = Object.keys(routes) as RouteName[]
  const implemented = Object.keys(handlers) as RouteName[]
  const undocumented = implemented.filter(name => !declared.includes(name))
  if (undocumented.length > 0) {
    throw new Error(`personal-track: route handlers with no declaration: ${undocumented.join(', ')}`)
  }

  return async (req: HabitRequest, res: HabitResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const method = (req.method ?? 'GET') as Method
      const path = url.pathname.slice(API_PREFIX.length) || '/'
      const name = routeFor(method, path)
      // Most bodies are small; the exceptions are named in one table.
      const limit = BODY_LIMITS[name] ?? BODY_LIMIT
      // Read unconditionally: `readJson` answers `{}` for an empty stream, and
      // deleting a check is addressed by its query string, so there is nothing
      // to special-case per verb.
      const body = await readJson(req, limit)
      const query = Object.fromEntries(url.searchParams.entries())
      const result = await handlers[name](ctx, body, query)
      // The one arm that is not JSON. The marker is in the result itself, so
      // the handler table needs no second dispatch table beside it.
      if ('binary' in result) {
        sendBinary(res, 200, result as BinaryResult)
        return
      }
      sendJson(res, 200, result)
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { error: { code: error.code, message: error.message } })
        return
      }
      if ((error as { code?: string }).code === 'missing-key') {
        sendJson(res, 404, { error: { code: 'habit/not-found', message: 'no such record' } })
        return
      }
      console.error('[personal-track] api failure', error)
      sendJson(res, 500, { error: { code: 'habit/internal', message: 'internal error' } })
    }
  }
}
