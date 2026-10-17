/**
 * Test support: an in-memory `Domain` and a portless HTTP driver.
 *
 * The host's business rules live behind two seams that were always injectable —
 * `createHabitStore(domain, config)` takes a `Domain`, and `createApiHandler`
 * takes its `store`/`backup`/`boundary`/`config`/`now` as arguments. What was
 * missing is an *adapter* for each: a `Domain` that keeps records in a `Map`
 * instead of on disk, and a request/response pair that is not a socket. With
 * those, every route and every mutation rule can be asserted in-process.
 *
 * This is why the fake is worth its keep: it does not re-implement storage.
 * `KvTable` has six methods, and `store.ts`/`backup.ts` use exactly those six.
 */
import { strict as assert } from 'node:assert'
import type { ImportMode } from '../src/host/backup.ts'
import { type Backup, createBackup } from '../src/host/backup.ts'
import { boundaryOf, clockOf, type Config } from '../src/host/config.ts'
import {
  habitDomainSpec,
  type HabitDomain,
} from '../src/host/domain.ts'
import type { DomainSpec } from '@deepseek-ai/dsh-storage-domain'
import type { ZodType } from 'zod'
import { type HabitHandler, type HabitRequest, type HabitResponse, API_PREFIX, createApiHandler } from '../src/host/api.ts'
import { createHabitStore, type HabitStore } from '../src/host/store.ts'

// --- the in-memory domain ----------------------------------------------------

/**
 * One table's storage: a map, a size, and the domain's single write chain.
 *
 * It validates like the real thing. The genuine domain parses every record
 * against its schema at the durable boundary, which is where a schema's
 * defaults (`materials: []`, `focusSessions: []`) actually get filled in — a
 * fake that skipped that step would let in-memory records drift into shapes
 * storage could never produce, and the rules under test would be testing the
 * wrong object.
 */
class MemoryTable {
  readonly records = new Map<string, unknown>()

  readonly #schema: ZodType | undefined

  /** Tail of the per-domain write chain; `update` serializes on it. */
  #chain: Promise<unknown> = Promise.resolve()

  constructor(schema?: ZodType) {
    this.#schema = schema
  }

  /** Parse one record the way the durable boundary would. */
  #parse(value: unknown): unknown {
    return this.#schema === undefined ? value : this.#schema.parse(value)
  }

  get size(): number {
    return this.records.size
  }

  get(key: string): unknown {
    return this.records.get(key)
  }

  /** A snapshot, like the real handle: iteration stays stable while writes land. */
  *entries(): IterableIterator<[string, unknown]> {
    yield* [...this.records.entries()]
  }

  *keys(): IterableIterator<string> {
    yield* [...this.records.keys()]
  }

  async put(key: string, value: unknown): Promise<void> {
    this.records.set(key, this.#parse(value))
  }

  async delete(key: string): Promise<boolean> {
    return this.records.delete(key)
  }

  /**
   * Atomic read-modify-write on the write chain.
   *
   * A missing key rejects with the same `code` the real domain uses, so the
   * API's `missing-key → 404` mapping is under test rather than assumed.
   */
  update(key: string, fn: (current: unknown) => unknown): Promise<unknown> {
    const run = this.#chain.then(async () => {
      const current = this.records.get(key)
      if (current === undefined) {
        throw Object.assign(new Error(`missing-key: ${key}`), { code: 'missing-key' })
      }
      const next = this.#parse(fn(current))
      this.records.set(key, next)
      return next
    })
    this.#chain = run.then(() => undefined, () => undefined)
    return run
  }
}

/**
 * A `Domain` over maps: the storage half of the plugin, without a medium.
 *
 * Deliberately *not* declared `implements Domain<S>`: the declared table handle
 * is generic over phantom key/value types that only exist at compile time,
 * while a map holds `unknown`. The single bridge between the two is
 * {@link memoryDomain}, so the cast is written once instead of per call site.
 */
class MemoryDomain<S extends DomainSpec> {
  readonly #spec: S
  readonly #tables = new Map<string, MemoryTable>()

  constructor(spec: S) {
    this.#spec = spec
  }

  get name(): S['name'] {
    return this.#spec.name
  }

  table(name: string): MemoryTable {
    const existing = this.#tables.get(name)
    if (existing !== undefined) return existing
    const declared = this.#spec.tables[name]
    if (declared === undefined) throw new Error(`undeclared table: ${name}`)
    const created = new MemoryTable(declared.valueSchema as ZodType)
    this.#tables.set(name, created)
    return created
  }

  async close(): Promise<void> {
    this.#tables.clear()
  }
}

/** Build the in-memory domain, bridged once to the plugin's `HabitDomain`. */
export function memoryDomain(): HabitDomain {
  return new MemoryDomain(habitDomainSpec) as unknown as HabitDomain
}

// --- a fixed clock -----------------------------------------------------------

/** A clock pinned to one instant, for deterministic `at` stamps. */
export function fixedClock(at: string): () => Date {
  const instant = new Date(at)
  return () => new Date(instant.getTime())
}

// --- the harness -------------------------------------------------------------

/** The config every test starts from. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    dayStartHour: 4,
    defaultVocabTarget: { new: 20, review: 60 },
    defaultRunMinutes: 30,
    ...overrides,
  }
}

/** One response as the driver captured it. */
export interface CallResult {
  readonly status: number
  /** The JSON body; `{}` for a response that carried bytes instead. */
  readonly body: Record<string, unknown>
  /** The response's own content-type, when it declared one. */
  readonly contentType?: string
  /** Raw bytes, for the one route that answers with them. */
  readonly bytes?: Buffer
}

/** A built plugin: the store, the backup surface and the route handler. */
export interface Harness {
  readonly store: HabitStore
  readonly backup: Backup
  readonly config: Config
  /** The instant the harness's clock is pinned to. */
  readonly now: () => Date
  /** Drive one route; never opens a socket. */
  call(method: string, path: string, body?: unknown): Promise<CallResult>
  /** Drive one route and return the refreshed state slice. */
  state(method: string, path: string, body?: unknown): Promise<Record<string, unknown>>
  /** Drive one route and return the entry it answers with. */
  entry(method: string, path: string, body?: unknown): Promise<Record<string, unknown>>
  /** Import a bundle straight through the backup surface. */
  import(mode: ImportMode, backup: unknown): Promise<unknown>
}

/**
 * Assemble the host half the way `host/index.ts` does, minus the medium.
 *
 * @param options - clock instant and config overrides.
 * @returns the store, backup surface and a portless `call`.
 */
export function createHarness(options: {
  readonly at?: string
  readonly config?: Partial<Config>
} = {}): Harness {
  const config = testConfig(options.config ?? {})
  const domain = memoryDomain()
  const store = createHabitStore(domain, config)
  const backup = createBackup(domain)
  const boundary = boundaryOf(config)
  // Through `clockOf`, the same seam production uses, rather than reaching
  // around it: if the config field ever stopped being honoured, this would
  // start stamping the real instant and the deterministic assertions would fail.
  const now = clockOf({ ...config, now: fixedClock(options.at ?? '2026-09-16T12:00:00Z') })
  const handler: HabitHandler = createApiHandler({ store, backup, boundary, config, now })

  /** A request double: the body as an async iterable of chunks. */
  function request(method: string, url: string, body?: unknown): HabitRequest {
    const text = body === undefined ? '' : JSON.stringify(body)
    return {
      method,
      url,
      async *[Symbol.asyncIterator](): AsyncIterator<Buffer> {
        if (text !== '') yield Buffer.from(text, 'utf8')
      },
    }
  }

  /** A response double, capturing what the handler wrote. */
  const captured: { status: number; body: Record<string, unknown>; contentType?: string; bytes?: Buffer } =
    { status: 0, body: {} }
  let settle: (value: CallResult) => void = () => {}

  function response(): { res: HabitResponse; result: Promise<CallResult> } {
    return {
      res: {
        writeHead(status: number, headers?: Record<string, string>): void {
          captured.status = status
          captured.contentType = headers?.['content-type']
        },
        // A string is a JSON body; a buffer is the asset route's bytes. Keeping
        // both arms here is what lets the binary path be asserted without a
        // socket — the transport decides which one it writes, not the test.
        end(body?: string | Buffer): void {
          if (typeof body === 'string') {
            captured.body = body === '' ? {} : JSON.parse(body) as Record<string, unknown>
          } else if (body !== undefined) {
            captured.bytes = body
            captured.body = {}
          }
          settle(captured)
        },
      },
      result: new Promise<CallResult>((resolve) => { settle = resolve }),
    }
  }

  async function call(method: string, path: string, body?: unknown): Promise<CallResult> {
    // The handler owns everything under its mount prefix and strips it before
    // matching, so the driver composes the same URL the web server would hand
    // over. Tests may write either the bare route or the full path.
    const mounted = path.startsWith(API_PREFIX) ? path : `${API_PREFIX}${path}`
    const pending = response()
    await handler(request(method, mounted, body), pending.res)
    return await pending.result
  }

  return {
    store,
    backup,
    config,
    now,
    call,
    async state(method, path, body) {
      const result = await call(method, path, body)
      assert.equal(result.body.ok, true, `${method} ${path} should answer with a state slice: ${JSON.stringify(result.body)}`)
      return result.body
    },
    async entry(method, path, body) {
      const result = await call(method, path, body)
      assert.equal(result.status, 200, `${method} ${path} should succeed: ${JSON.stringify(result.body)}`)
      assert.ok(result.body.entry, `${method} ${path} should answer with the entry it changed`)
      return result.body.entry as Record<string, unknown>
    },
    import: (mode, value) => backup.importAll(value, mode),
  }
}

// --- the mini test runner ----------------------------------------------------

/** A labelled-case runner; the two existing test files each carry their own. */
export interface Checker {
  /** Run one labelled case; a throw fails the file. */
  check(label: string, fn: () => void): void
  /** Assert an async case. */
  checkAsync(label: string, fn: () => Promise<void>): Promise<void>
  /** Print the tally and exit non-zero when anything failed. */
  report(): void
}

/**
 * Create a case runner.
 *
 * Unlike the pre-existing `check()` helpers this one counts failures, reports
 * every one of them, and exits non-zero — a mid-file failure should not stop
 * the remaining cases from running.
 */
export function createChecker(heading: string): Checker {
  let passed = 0
  const failed: { label: string; cause: unknown }[] = []
  console.log(heading)

  const run = (label: string, fn: () => unknown): void => {
    try {
      const result = fn()
      if (result instanceof Promise) throw new Error('use checkAsync for an async case')
      passed += 1
      console.log(`  ✓ ${label}`)
    } catch (cause) {
      failed.push({ label, cause })
      console.log(`  ✗ ${label}`)
    }
  }

  return {
    check: run,
    async checkAsync(label, fn) {
      try {
        await fn()
        passed += 1
        console.log(`  ✓ ${label}`)
      } catch (cause) {
        failed.push({ label, cause })
        console.log(`  ✗ ${label}`)
      }
    },
    report() {
      for (const { label, cause } of failed) {
        console.error(`\n✗ ${label}`)
        console.error(cause)
      }
      console.log(`\n${passed} passed, ${failed.length} failed`)
      if (failed.length > 0) process.exitCode = 1
    },
  }
}
