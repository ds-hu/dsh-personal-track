/**
 * The browser half's client for the plugin's own HTTP API.
 *
 * Every mutation answers with the refreshed state slice, so the board never has
 * to re-read after a write. Failures arrive as `HabitApiError`, carrying the
 * host's own code so the UI can say something specific.
 */
import { API_PREFIX, routes, urlOf, type RouteName } from '../shared/route.ts'
import type {
  BackupBundle,
  ClockView,
  ImportMode,
  ImportResult,
  MediaEntry,
  RegistryKind,
  StateView,
  StatsView,
  TaskEntry,
} from './types.ts'

/** The route prefix this plugin owns on the GUI host. */
const BASE = API_PREFIX

/**
 * One API failure as the host reported it.
 *
 * Fields are assigned explicitly, not as constructor parameter properties:
 * that construct is the one piece of TypeScript syntax Node's native type
 * stripping refuses, and this module is imported by tests that run that way.
 */
export class HabitApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'HabitApiError'
    this.status = status
    this.code = code
  }
}

/** Our own view of a habit, as the check endpoints name it. */
export type CheckHabit = 'wash' | 'shower'

/** One meal slot. */
export type MealSlot = 'breakfast' | 'lunch' | 'dinner'

/** Meal edit options: `time` retimes the slot, `price` sets or clears it. */
export interface MealOptions {
  /** `HH:mm`; the host resolves it inside the habit day. */
  readonly time?: string
  readonly price?: number
}

/** Session-bearing habits (running is single-valued and handled apart). */
export type SessionKind = 'vocab' | 'duolingo' | 'rope' | 'pullup' | 'plank' | 'equipment' | 'washing'

/** The vocabulary target for one habit day. */
export interface VocabTarget {
  readonly new: number
  readonly review: number
}

/** Running entry options; the host defaults the duration. */
export interface RunOptions {
  readonly minutes?: number
  readonly distanceKm: number
  readonly avgHr?: number
}

/** The command surface the board receives through slot injection. */
export interface HabitClient {
  clock(): Promise<ClockView>
  state(date?: string): Promise<StateView>
  check(date: string, habit: CheckHabit): Promise<StateView>
  /** Remove one recorded check; `index` defaults to the most recent. */
  uncheck(date: string, habit: CheckHabit, index?: number): Promise<StateView>
  /** Retime one recorded check; `index` defaults to the most recent. */
  editCheck(date: string, habit: CheckHabit, index: number | undefined, time: string): Promise<StateView>
  setMeal(date: string, slot: MealSlot, options?: MealOptions): Promise<StateView>
  clearMeal(date: string, slot: MealSlot): Promise<StateView>
  /** Set the exact stock value; the answer is the day's slice, plus the stock. */
  setStock(pending: number, viewpoint?: Viewpoint): Promise<StateView>
  /** A wash happened: record it, optionally at a known hour. */
  wash(date: string, pieces: number, time?: string): Promise<StateView>
  /** Append one session; the host stamps `at` and assigns the id. */
  addSession(date: string, kind: SessionKind, entry: Record<string, unknown>): Promise<StateView>
  patchSession(date: string, kind: SessionKind, id: string, patch: Record<string, unknown>): Promise<StateView>
  removeSession(date: string, kind: SessionKind, id: string): Promise<StateView>
  setVocabTarget(date: string, target: VocabTarget): Promise<StateView>
  setRun(date: string, options: RunOptions): Promise<StateView>
  clearRun(date: string): Promise<StateView>
  /**
   * Registries: the lists are global, the answer is a habit day's slice.
   *
   * `viewpoint` is the day the caller is showing, so the answer can be adopted
   * without a second read; omit it for today.
   */
  addMedia(input: MediaInput, viewpoint?: Viewpoint): Promise<EntryAnswer>
  patchMedia(id: string, patch: MediaPatch, viewpoint?: Viewpoint): Promise<EntryAnswer>
  removeMedia(id: string, viewpoint?: Viewpoint): Promise<RemovedAnswer>
  addTask(input: TaskInput, viewpoint?: Viewpoint): Promise<EntryAnswer>
  patchTask(id: string, patch: TaskPatch, viewpoint?: Viewpoint): Promise<EntryAnswer>
  removeTask(id: string, viewpoint?: Viewpoint): Promise<RemovedAnswer>
  /**
   * Where an `<img src>` points for one stored image.
   *
   * The one client method that is not a request: image bytes never travel in a
   * state slice, so the browser's own image pipeline fetches and caches them by
   * URL.
   */
  assetUrl(assetId: string): string
  /** Store an image and append it to an entry's materials. */
  addImageMaterial(owner: RegistryKind, id: string, image: ImageInput, viewpoint?: Viewpoint): Promise<EntryAnswer>
  /** Append a Markdown text block to an entry's materials. */
  addTextMaterial(owner: RegistryKind, id: string, text: string, viewpoint?: Viewpoint): Promise<EntryAnswer>
  /** Rewrite one Markdown block's text. */
  patchTextMaterial(owner: RegistryKind, id: string, materialId: string, text: string, viewpoint?: Viewpoint): Promise<EntryAnswer>
  /** Remove one material; an image takes its stored bytes with it. */
  removeMaterial(owner: RegistryKind, id: string, materialId: string, viewpoint?: Viewpoint): Promise<EntryAnswer>
  /** Delete every stored image nothing references. */
  sweepAssets(): Promise<SweepResult>
  /** Open a focus session; a session a crash left open is dropped first. */
  startFocus(owner: RegistryKind, id: string, viewpoint?: Viewpoint): Promise<FocusAnswer>
  /**
   * Close one focus session; an already-closed one is left alone.
   *
   * No viewpoint: the overlay that calls this adopts the answer's `entry` only,
   * so the day the slice describes does not concern it.
   */
  endFocus(owner: RegistryKind, id: string, sessionId: string, options?: EndFocusOptions): Promise<EntryAnswer>
  /** Range aggregates, computed on the host. */
  stats(from: string, to: string): Promise<StatsView>
  /** The whole domain as one portable document. */
  exportAll(): Promise<BackupBundle>
  /** Validate and apply a backup document; `replace` also drops what it omits. */
  importAll(mode: ImportMode, backup: unknown, viewpoint?: Viewpoint): Promise<ImportResult>
}

/** Fields a new media entry carries. */
export interface MediaInput {
  readonly kind: 'film' | 'book'
  readonly title: string
  readonly status?: 'active' | 'done' | 'dropped'
  readonly rating?: number
  readonly notes?: string
}

/** A media patch; `null` clears an optional field. */
export interface MediaPatch {
  readonly kind?: 'film' | 'book'
  readonly title?: string
  readonly status?: 'active' | 'done' | 'dropped'
  readonly rating?: number | null
  readonly notes?: string | null
  readonly startedAt?: string | null
  readonly finishedAt?: string | null
}

/** A checkpoint as the wire carries it: content only — the host owns the id. */
export interface TaskCheckpointInput {
  readonly label: string
  readonly at: number
}

/** Fields a new task carries. */
export interface TaskInput {
  readonly title: string
  readonly category?: string
  readonly due?: string
  readonly progress?: { readonly current?: number; readonly total?: number }
  readonly checkpoints?: readonly TaskCheckpointInput[]
  readonly notes?: string
}

/** A task patch; `null` clears an optional field, `progress` merges. */
export interface TaskPatch {
  readonly title?: string
  readonly category?: string | null
  readonly due?: string | null
  readonly progress?: { readonly current?: number; readonly total?: number | null }
  readonly checkpoints?: readonly TaskCheckpointInput[]
  readonly notes?: string | null
}

/**
 * Which habit day a write's answer should describe.
 *
 * A registry entry belongs to no habit day, but the board is showing one, so it
 * sends that day up and adopts the answer directly instead of asking again
 * (docs/adr/0004-write-answers-the-day-slice.md). Omitted means today.
 */
export interface Viewpoint {
  readonly date?: string
}

/**
 * A write's answer: the day's state slice, plus the entry it changed.
 *
 * Every mutation answers this shape — the day, the stock and both registries —
 * so there is one adoption path, not one per route family. The entry is the
 * state slice's shape and not the stored record: an image material carries the
 * mime and the byte size derived from its asset, and the entry carries its
 * derived `focusSeconds`, so adopting a record would show up as missing images
 * and a zero focus total. Focus mode adopts this whole, which is why the
 * distinction is stated here.
 */
export interface EntryAnswer extends StateView {
  /** The changed entry, in the state slice's shape. */
  readonly entry?: TaskEntry | MediaEntry
}

/** A delete's answer: the day's slice, plus whether anything was actually there. */
export interface RemovedAnswer extends StateView {
  readonly removed: boolean
}

/** Opening a focus session answers with the entry *and* the session it opened. */
export interface FocusAnswer extends EntryAnswer {
  /** The session just opened, so the caller can close exactly that one. */
  readonly sessionId: string
}

/** What an orphan sweep answers with. */
export interface SweepResult {
  readonly ok: true
  readonly removed: number
}

/** One image on its way into the store. */
export interface ImageInput {
  readonly mime: string
  /** Base64 payload; the browser half encodes before it sends. */
  readonly data: string
  readonly name?: string
}

/** A JSON request body, with the verb taken from the route table. */
function body(name: RouteName, payload: unknown): RequestInit {
  return {
    method: routes[name].method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  }
}

/** How the client reaches the host: injectable so a test can drive it. */
export interface HabitClientOptions {
  /** Prefix the API is mounted under. */
  readonly base?: string
  /** The fetch implementation; defaults to the platform's. */
  readonly doFetch?: typeof fetch
}

/** Options for closing a focus session. */
export interface EndFocusOptions {
  /**
   * Let the request outlive the document that sent it.
   *
   * The one caller that needs this is a page going away: a refresh or a closed
   * tab is a real end of the session, and a request that dies with the document
   * would leave the session open for the store to discard — which is the same
   * as losing the time it held.
   */
  readonly keepalive?: boolean
}

/**
 * The failure a half-updated install reports.
 *
 * A host half is only replaced by a `dsh` restart while this bundle hot reloads
 * on its own, so a client is routinely newer than the host it talks to. The
 * reads that need a field the older host did not send check for it here, and a
 * registry *write* checks the one thing it cannot afford to adopt: an entry
 * that is the stored record rather than the view (the caller's check — see
 * `isEntryView` in `board/focus.ts`). Naming the situation is the difference
 * between "restart dsh" and an entry that draws its own images as missing.
 */
export function staleHostError(): HabitApiError {
  return new HabitApiError(0, 'habit/stale-host', '插件宿主半身未更新：请重启 dsh --profile web')
}

/**
 * Create the command surface handed to the board through slot injection.
 *
 * @param options - base prefix and fetch, for a test that wants to observe the
 *   requests rather than make them.
 */
export function createHabitClient(options: HabitClientOptions = {}): HabitClient {
  const base = options.base ?? BASE
  const doFetch = options.doFetch ?? fetch
  const url = (name: RouteName, params?: Record<string, string | number | undefined>): string =>
    `${base}${urlOf(name, params).slice(API_PREFIX.length)}`

  /** Perform one call, turning a failure payload into a `HabitApiError`. */
  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await doFetch(path, init)
    } catch (cause) {
      throw new HabitApiError(0, 'habit/unreachable', `无法连接插件服务：${String(cause)}`)
    }
    const payload = await response.json().catch(() => null) as
      | { error?: { code?: string; message?: string } }
      | null
    if (!response.ok) {
      throw new HabitApiError(
        response.status,
        payload?.error?.code ?? 'habit/unknown',
        payload?.error?.message ?? `HTTP ${response.status}`,
      )
    }
    return payload as T
  }

  /**
   * The host half is only replaced by a `dsh` restart, while this bundle hot
   * reloads on its own, so this client can legitimately be newer than the host
   * it talks to. Say what to do instead of failing on a missing field.
   */
  const staleHost = (): never => {
    throw staleHostError()
  }

  /**
   * A payload with the caller's **viewpoint** folded in.
   *
   * The day is optional the whole way down: a call that does not name one is
   * answered for today, which is what the focus overlay's own writes want.
   */
  const withDay = (
    viewpoint: Viewpoint | undefined,
    payload: object,
  ): Record<string, unknown> =>
    (viewpoint?.date === undefined
      ? { ...payload }
      : { ...payload, date: viewpoint.date })

  /** The same for a query-addressed route; absent means "today", not "undefined". */
  const dayQuery = (viewpoint: Viewpoint | undefined): { date?: string } =>
    (viewpoint?.date === undefined ? {} : { date: viewpoint.date })

  return {
    clock: async () => {
      const value = await request<ClockView>(url('clock'))
      if (typeof value.today !== 'string') staleHost()
      return value
    },
    state: async date => {
      const value = await request<StateView>(url('state', { date }))
      if (value.day === undefined || typeof value.day.date !== 'string') staleHost()
      return value
    },
    check: (date, habit) => request<StateView>(url('check'), body('check', { date, habit })),
    uncheck: (date, habit, index) => request<StateView>(
      url('uncheck', { date, habit, index }),
      { method: routes.uncheck.method },
    ),
    editCheck: (date, habit, index, time) => request<StateView>(url('editCheck'), body('editCheck', {
      date,
      habit,
      ...(index === undefined ? {} : { index }),
      time,
    })),
    setMeal: (date, slot, options) => request<StateView>(url('setMeal'), body('setMeal', {
      date,
      slot,
      ...(options?.time === undefined ? {} : { time: options.time }),
      ...(options?.price === undefined ? {} : { price: options.price }),
    })),
    clearMeal: (date, slot) => request<StateView>(
      url('clearMeal', { date, slot }),
      { method: routes.clearMeal.method },
    ),
    setStock: (pending, viewpoint) => request<StateView>(
      url('laundryStock'),
      body('laundryStock', withDay(viewpoint, { pending })),
    ),
    wash: (date, pieces, time) => request<StateView>(url('laundryWash'), body('laundryWash', {
      date,
      pieces,
      ...(time === undefined ? {} : { time }),
    })),
    addSession: (date, kind, entry) => request<StateView>(url('addSession'), body('addSession', { date, kind, entry })),
    patchSession: (date, kind, id, patch) => request<StateView>(url('patchSession'), body('patchSession', { date, kind, id, patch })),
    removeSession: (date, kind, id) => request<StateView>(
      url('removeSession', { date, kind, id }),
      { method: routes.removeSession.method },
    ),
    setVocabTarget: (date, target) => request<StateView>(
      url('setVocabTarget'),
      body('setVocabTarget', { date, new: target.new, review: target.review }),
    ),
    setRun: (date, run) => request<StateView>(url('setRun'), body('setRun', { date, ...run })),
    clearRun: date => request<StateView>(url('clearRun', { date }), { method: routes.clearRun.method }),
    addMedia: (input, viewpoint) =>
      request<EntryAnswer>(url('addMedia'), body('addMedia', withDay(viewpoint, input))),
    patchMedia: (id, patch, viewpoint) =>
      request<EntryAnswer>(url('patchMedia'), body('patchMedia', withDay(viewpoint, { id, patch }))),
    removeMedia: (id, viewpoint) => request<RemovedAnswer>(
      url('removeMedia', { id, ...dayQuery(viewpoint) }),
      { method: routes.removeMedia.method },
    ),
    addTask: (input, viewpoint) =>
      request<EntryAnswer>(url('addTask'), body('addTask', withDay(viewpoint, input))),
    patchTask: (id, patch, viewpoint) =>
      request<EntryAnswer>(url('patchTask'), body('patchTask', withDay(viewpoint, { id, patch }))),
    removeTask: (id, viewpoint) => request<RemovedAnswer>(
      url('removeTask', { id, ...dayQuery(viewpoint) }),
      { method: routes.removeTask.method },
    ),
    assetUrl: assetId => url('asset', { id: assetId }),
    addImageMaterial: (owner, id, image, viewpoint) => request<EntryAnswer>(
      url('addAsset'),
      body('addAsset', withDay(viewpoint, {
        kind: owner,
        id,
        mime: image.mime,
        data: image.data,
        ...(image.name === undefined ? {} : { name: image.name }),
      })),
    ),
    addTextMaterial: (owner, id, text, viewpoint) =>
      request<EntryAnswer>(url('addMaterial'), body('addMaterial', withDay(viewpoint, { kind: owner, id, text }))),
    patchTextMaterial: (owner, id, materialId, text, viewpoint) => request<EntryAnswer>(
      url('patchMaterial'),
      body('patchMaterial', withDay(viewpoint, { kind: owner, id, materialId, text })),
    ),
    removeMaterial: (owner, id, materialId, viewpoint) => request<EntryAnswer>(
      url('removeMaterial', { kind: owner, id, materialId, ...dayQuery(viewpoint) }),
      { method: routes.removeMaterial.method },
    ),
    sweepAssets: async () => {
      const value = await request<SweepResult>(url('sweepAssets'), { method: routes.sweepAssets.method })
      if (typeof value.removed !== 'number') staleHost()
      return value
    },
    startFocus: async (owner, id, viewpoint) => {
      const value = await request<FocusAnswer>(
        url('focusStart'),
        body('focusStart', withDay(viewpoint, { kind: owner, id })),
      )
      if (typeof value.sessionId !== 'string') staleHost()
      return value
    },
    endFocus: (owner, id, sessionId, options) => request<EntryAnswer>(
      url('focusEnd'),
      {
        ...body('focusEnd', { kind: owner, id, sessionId }),
        // Only ever sent as `true`: an absent key is the transport's default.
        ...(options?.keepalive === true ? { keepalive: true } : {}),
      },
    ),
    stats: (from, to) => request<StatsView>(url('stats', { from, to })),
    exportAll: async () => {
      const value = await request<{ ok: true; backup: BackupBundle }>(url('exportBackup'))
      if (value.backup === undefined) staleHost()
      return value.backup
    },
    importAll: (mode, backup, viewpoint) =>
      request<ImportResult>(url('importBackup'), body('importBackup', withDay(viewpoint, { mode, backup }))),
  }
}
