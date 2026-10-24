/**
 * The habit store: typed access to the `habit` domain plus every mutation the
 * API exposes.
 *
 * Reads come from the domain's authoritative in-memory snapshot, so a view is
 * cheap. Writes use the domain's single per-domain chain; `mutateDay` is an
 * atomic read-modify-write, so concurrent check-ins never interleave. Every
 * write is re-validated by the record schema before it is stored.
 *
 * A day with no entries has **no document** — that is what "empty day" means.
 * Reads therefore never create documents; only a mutation materializes one.
 */
import { randomUUID } from 'node:crypto'
import { ApiError } from './api-error.ts'
import { clockOf, type Config, type VocabTarget } from './config.ts'
import type {
  AssetRecord,
  CounterRecord,
  DayRecord,
  HabitDomain,
  Material,
  MediaRecord,
  RegistryRecord,
  TaskRecord,
} from './domain.ts'
import { assetRecord, dayRecord, mediaRecord, taskRecord } from './domain.ts'
import { habitOf, type CheckHabit } from './habits.ts'
import {
  cellProgress,
  dayCells,
  focusSeconds,
  isOverdue,
  isPerfectDay,
  taskState,
  vocabProgress,
  type Cell,
  type DueTask,
  type TaskState,
  type VocabProgress,
} from './derive.ts'
import type { DayKey } from '../shared/habit-day.ts'

/** The laundry stock's key inside the counters table. */
export const LAUNDRY_KEY = 'laundry'

/** Session-bearing habits (running is single-valued and handled apart). */
export type SessionKind = 'vocab' | 'duolingo' | 'rope' | 'pullup' | 'plank' | 'equipment' | 'washing'

/** Everything the board needs about one habit day. */
export interface DayView {
  readonly date: DayKey
  readonly isToday: boolean
  /** `null` when the day has no stored document yet. */
  readonly day: DayRecord | null
  /** The effective vocabulary target: own snapshot, else inherited, else config. */
  readonly target: VocabTarget
  readonly vocab: VocabProgress
  readonly cells: Cell[]
  /** `done` is fractional to one decimal; `total` grows with the due tasks. */
  readonly progress: { done: number; total: number }
}

/** One complete state slice — what reads and every mutation return. */
export interface StateView {
  readonly day: DayView
  readonly stock: CounterRecord
  readonly media: MediaView[]
  readonly tasks: TaskView[]
}

/**
 * One material as a view carries it.
 *
 * The stored shape is the reference; the view adds what the asset document
 * knows — its mime and its byte size — because those are derived values, and
 * deriving them here is what keeps a size out of storage
 * (docs/adr/0002-derived-state-not-stored.md). Both are absent when the asset
 * itself is gone, which a hand-edited backup can produce; the board draws such
 * a material as missing rather than silently as an empty image.
 */
export type MaterialView =
  | { readonly kind: 'md'; readonly id: string; readonly text: string }
  | {
      readonly kind: 'image'
      readonly id: string
      readonly assetId: string
      readonly name?: string
      readonly createdAt: string
      readonly mime?: string
      readonly bytes?: number
    }

/**
 * A media entry plus everything the view derives from it.
 *
 * `focusSeconds` is the same rule the task side follows: sessions are the
 * fact, time spent is the read-side sum.
 */
export interface MediaView extends Omit<MediaRecord, 'materials'> {
  readonly materials: MaterialView[]
  readonly focusSeconds: number
}

/**
 * A task plus both states derived from it, computed here so the derivation
 * rules live in exactly one place (docs/adr/0002-derived-state-not-stored.md).
 */
export interface TaskView extends TaskRecord {
  readonly state: TaskState
  readonly overdue: boolean
  readonly materials: MaterialView[]
  readonly focusSeconds: number
}

/** Which registry a material or focus session belongs to. */
export type OwnerKind = 'task' | 'media'

/** One image a caller hands the store; the id and instant are the store's. */
export interface NewImage {
  readonly mime: string
  /** Base64 payload. */
  readonly data: string
  readonly name?: string
}

/** Everything derived from one habit day, with its document read once. */
export interface DayFacts {
  readonly date: DayKey
  /** The stored document, or null for an untouched day. */
  readonly stored: DayRecord | null
  /** The day as the UI sees it: an absent vocabulary block is filled in. */
  readonly day: DayRecord
  readonly target: VocabTarget
  readonly vocab: VocabProgress
  /** Habit cells plus one per task due this day (see `dayCells`). */
  readonly cells: Cell[]
  /** `done` is fractional to one decimal; `total` grows with the due tasks. */
  readonly progress: { readonly done: number; readonly total: number }
  readonly perfect: boolean
}

/** The store surface the API and the statistics use. */
export interface HabitStore {
  /** The stored document, or undefined for an untouched day. */
  readDay(key: DayKey): DayRecord | undefined
  /** The stored document plus every value derived from it. */
  dayFacts(key: DayKey): DayFacts
  /** Own target snapshot → carry-forward → config default. */
  resolveTarget(key: DayKey): VocabTarget
  view(key: DayKey, today: DayKey): StateView
  mutateDay(key: DayKey, apply: (day: DayRecord) => Record<string, unknown>): Promise<DayRecord>
  /**
   * Record one **打卡** at `at`.
   *
   * The habit's daily cap is checked **inside** the atomic read-modify-write, so
   * two concurrent check-ins can never land a third wash: each writer sees the
   * count the one before it committed, which is exactly what the cap outside the
   * closure could not do.
   */
  addCheck(key: DayKey, habit: CheckHabit, at: string): Promise<DayRecord>
  /** Retime one recorded **打卡**; `index` defaults to the most recent. */
  retimeCheck(key: DayKey, habit: CheckHabit, at: string, index?: number): Promise<DayRecord>
  /**
   * Remove one recorded **打卡**; `index` defaults to the most recent.
   *
   * Idempotent by design: removing something already gone is not a fault (a
   * second click, or the same delete from two windows), so nothing is thrown —
   * unlike {@link retimeCheck}, which addresses a record that must exist.
   */
  removeCheck(key: DayKey, habit: CheckHabit, index?: number): Promise<DayRecord>
  setVocabTarget(key: DayKey, target: VocabTarget): Promise<DayRecord>
  addSession(key: DayKey, kind: SessionKind, entry: Record<string, unknown>): Promise<DayRecord>
  patchSession(key: DayKey, kind: SessionKind, id: string, patch: Record<string, unknown>): Promise<DayRecord>
  removeSession(key: DayKey, kind: SessionKind, id: string): Promise<DayRecord>
  /** Stock down by `pieces` and one washing session appended. */
  wash(key: DayKey, pieces: number, at: string): Promise<{ day: DayRecord; stock: CounterRecord }>
  /** Correction: the stock only — no event, no history. */
  setStock(pending: number, at: string): Promise<CounterRecord>
  putMedia(record: MediaRecord): Promise<void>
  /** Patch fields; `null` clears one (see {@link withoutCleared}). */
  patchMedia(id: string, patch: Record<string, unknown>): Promise<MediaRecord>
  deleteMedia(id: string): Promise<boolean>
  putTask(record: TaskRecord): Promise<void>
  /** Patch fields; `null` clears one, and completion follows progress. */
  patchTask(id: string, patch: Record<string, unknown>): Promise<TaskRecord>
  deleteTask(id: string): Promise<boolean>
  /** Append one Markdown block to a registry entry's materials. */
  addMaterialText(owner: OwnerKind, id: string, text: string): Promise<void>
  /** Store one image and append it to a registry entry's materials. */
  addMaterialImage(owner: OwnerKind, id: string, image: NewImage): Promise<void>
  /** Rewrite one Markdown block's text. */
  patchMaterialText(owner: OwnerKind, id: string, materialId: string, text: string): Promise<void>
  /** Remove one material; an image takes its asset with it. */
  removeMaterial(owner: OwnerKind, id: string, materialId: string): Promise<void>
  /** One stored image, or undefined. */
  readAsset(assetId: string): AssetRecord | undefined
  /** Open a focus session; one a crash left open is dropped first. */
  startFocus(owner: OwnerKind, id: string): Promise<string>
  /** Close one focus session; an already-closed one is left alone. */
  endFocus(owner: OwnerKind, id: string, sessionId: string): Promise<void>
  /** Delete every asset nothing references; answers how many went. */
  sweepOrphanAssets(): Promise<number>
  newId(): string
}

/** Session-array field names for the non-vocabulary kinds. */
const SESSION_FIELD = {
  duolingo: 'duolingo',
  rope: 'rope',
  pullup: 'pullup',
  plank: 'plank',
  equipment: 'equipment',
  washing: 'washing',
} as const

/**
 * One registry table, as the shared material and focus paths see it.
 *
 * `tasks` and `media` are separate typed handles, and a union of two generic
 * handles is not callable — their `update` signatures do not unify. The bridge
 * is written once here instead of casting at every call site, and
 * `parseRegistry` is what keeps the two record schemas apart.
 */
interface RegistryTable {
  get(key: string): RegistryRecord | undefined
  delete(key: string): Promise<boolean>
  update(key: string, fn: (current: RegistryRecord) => RegistryRecord): Promise<RegistryRecord>
  entries(): IterableIterator<[string, RegistryRecord]>
}

/**
 * The bytes a base64 payload decodes to, derived from its length.
 *
 * Derived on purpose: storing a size next to the bytes would be a second copy
 * of the same fact, and the whole point of the assets table is that the bytes
 * are the only thing about an image that is stored
 * (docs/adr/0002-derived-state-not-stored.md). The API's size cap measures the
 * same way, so the limit the picker applies and the limit the host enforces are
 * the same limit — an encoded length is up to three bytes coarser than the
 * payload it carries.
 */
export function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding)
}

/** An empty progress, used only when a record somehow carries no vocabulary. */
const NO_PROGRESS: VocabProgress = {
  doneNew: 0, doneReview: 0, targetNew: 0, targetReview: 0,
  minutes: 0, ratio: 0, surplusNew: 0, surplusReview: 0, met: false,
}

/**
 * Drop keys a patch explicitly cleared with `null`.
 *
 * PATCH semantics: an absent key means "leave it", `null` means "remove it" —
 * otherwise a due date, a rating or a note could never be taken back.
 */
function withoutCleared(record: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (value !== null) next[key] = value
  }
  return next
}

/**
 * Keep every checkpoint's `reachedAt` in step with the progress: crossing a
 * threshold stamps the instant, dropping back below it clears the fact, and
 * crossing again re-stamps — the same rule `completedAt` follows. A patch that
 * jumps over several thresholds stamps them all with the same instant, which
 * is honest: one write crossed them.
 */
function syncCheckpoints(task: TaskRecord, now: () => Date): TaskRecord {
  if (task.checkpoints.length === 0) return task
  const current = task.progress.current
  let changed = false
  const checkpoints = task.checkpoints.map((checkpoint) => {
    if (current >= checkpoint.at && checkpoint.reachedAt === undefined) {
      changed = true
      return { ...checkpoint, reachedAt: now().toISOString() }
    }
    if (current < checkpoint.at && checkpoint.reachedAt !== undefined) {
      changed = true
      const { reachedAt: _cleared, ...rest } = checkpoint
      return rest
    }
    return checkpoint
  })
  return changed ? { ...task, checkpoints } : task
}

/**
 * Checkpoints sit on the progress axis, which only a total gives a task — a
 * checkbox task has no stages to mark. Enforced on every write path so an
 * orphaned checkpoint cannot enter storage (nor, via the same rule, a backup
 * file).
 */
function assertCheckpointsFit(task: TaskRecord): void {
  if (task.checkpoints.length > 0 && task.progress.total === undefined) {
    throw new ApiError(
      400,
      'habit/task-checkpoints-need-total',
      'a task with checkpoints needs a progress total',
    )
  }
}

/** The daily cap one 打卡 habit carries, from the habit inventory. */
function checkLimitOf(habit: CheckHabit): number {
  return habitOf(habit).maxPerDay ?? 1
}

/**
 * What a refused 打卡 says.
 *
 * Kept beside the methods rather than in the inventory: the inventory is domain
 * data, this is the wording of one failure. It is a `Record<CheckHabit, …>`, so
 * a new 打卡 habit cannot be added without deciding what its refusal reads like.
 */
const CHECK_LIMIT_MESSAGE: Record<CheckHabit, string> = {
  wash: '洗漱每日至多两次',
  shower: '洗澡每日至多一次',
}

/** Build the store over an opened domain. */
export function createHabitStore(domain: HabitDomain, config: Config): HabitStore {
  const days = domain.table('days')
  const counters = domain.table('counters')
  const media = domain.table('media')
  const tasks = domain.table('tasks')
  const assets = domain.table('assets')

  /**
   * The clock every derived instant is stamped with.
   *
   * Completion is derived from progress, so the instant it happened is written
   * here rather than trusted from a caller — which means this module is where
   * "now" is actually consulted, and it must be the same clock the API uses.
   * Reaching for `new Date()` directly here would put two clocks in one plugin
   * and make the derived instants untestable.
   */
  const now = clockOf(config)

  /** Copies so callers can never mutate a stored record in place. */
  const copyTarget = (target: VocabTarget): VocabTarget => ({ new: target.new, review: target.review })

  /** Session entries of one habit kind. */
  function sessionsOf(day: DayRecord, kind: SessionKind): readonly Record<string, unknown>[] {
    switch (kind) {
      case 'vocab': return day.vocab?.sessions ?? []
      case 'duolingo': return day.duolingo
      case 'rope': return day.rope
      case 'pullup': return day.pullup
      case 'plank': return day.plank
      case 'equipment': return day.equipment
      case 'washing': return day.washing
    }
  }

  /** Rebuild a day with one kind's session array replaced. */
  function withSessions(
    day: DayRecord,
    kind: SessionKind,
    key: DayKey,
    next: readonly Record<string, unknown>[],
  ): Record<string, unknown> {
    if (kind === 'vocab') {
      return { ...day, vocab: { target: day.vocab?.target ?? resolveTarget(key), sessions: next } }
    }
    return { ...day, [SESSION_FIELD[kind]]: next }
  }

  /** The most recent day before `key` that carries a vocabulary target. */
  function carryForward(key: DayKey): VocabTarget | undefined {
    let best: DayKey | undefined
    for (const [candidate, record] of days.entries()) {
      if (candidate >= key || record.vocab === undefined) continue
      if (best === undefined || candidate > best) best = candidate
    }
    if (best === undefined) return undefined
    const found = days.get(best)?.vocab?.target
    return found === undefined ? undefined : copyTarget(found)
  }

  function resolveTarget(key: DayKey): VocabTarget {
    const own = days.get(key)?.vocab?.target
    if (own !== undefined) return copyTarget(own)
    return carryForward(key) ?? copyTarget(config.defaultVocabTarget)
  }

  /** The day as the UI sees it: an absent vocabulary block is filled from the
   *  effective target so progress renders before the first write. */
  function effective(key: DayKey): DayRecord {
    const stored = days.get(key)
    if (stored?.vocab !== undefined) return stored
    const target = resolveTarget(key)
    return stored === undefined
      ? dayRecord.parse({ date: key, vocab: { target, sessions: [] } })
      : dayRecord.parse({ ...stored, vocab: { target, sessions: [] } })
  }

  /** Materialize an untouched day so the atomic RMW below has a document. */
  async function materialize(key: DayKey): Promise<void> {
    if (days.get(key) === undefined) {
      await days.put(key, dayRecord.parse({ date: key, vocab: { target: resolveTarget(key), sessions: [] } }))
    }
  }

  function stock(): CounterRecord {
    return counters.get(LAUNDRY_KEY) ?? { pending: 0, updatedAt: new Date(0).toISOString() }
  }

  /**
   * The tasks whose deadline falls on `key`, as the day's bar sees them.
   *
   * Tasks carry no habit day, so the deadline is the only link — and it is the
   * *current* state of those tasks that counts, not how they stood on that day:
   * finishing today's homework fills today's square, just as editing a session
   * retroactively moves that day's progress.
   */
  function dueTasksOn(key: DayKey): DueTask[] {
    const due: DueTask[] = []
    for (const [, record] of tasks.entries()) {
      if (record.due !== key) continue
      due.push({
        id: record.id,
        title: record.title,
        current: record.progress.current,
        total: record.progress.total,
      })
    }
    return due.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
  }

  const byCreatedAtDesc = <T extends { createdAt: string }>(entries: Iterable<T>): T[] =>
    [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

  /** The table behind one registry kind, seen through the shared bridge. */
  const registryTable = (owner: OwnerKind): RegistryTable =>
    (owner === 'task' ? tasks : media) as unknown as RegistryTable

  /** Parse a record with the schema of its own registry. */
  const parseRegistry = (owner: OwnerKind, record: Record<string, unknown>): RegistryRecord =>
    owner === 'task' ? taskRecord.parse(record) : mediaRecord.parse(record)

  /**
   * Read-modify-write one registry entry.
   *
   * `update` is the domain's atomic per-record transform, so two pastes landing
   * together cannot lose one of them; a missing entry rejects with
   * `missing-key`, which the transport maps to a 404.
   */
  const updateRegistry = (
    owner: OwnerKind,
    id: string,
    apply: (record: RegistryRecord) => RegistryRecord,
  ): Promise<RegistryRecord> => registryTable(owner).update(id, apply)

  /** One material with its asset's derived facts — mime and size — attached. */
  function materialView(material: Material): MaterialView {
    if (material.kind === 'md') return material
    const asset = assets.get(material.assetId)
    return asset === undefined
      ? material
      : { ...material, mime: asset.mime, bytes: base64Bytes(asset.data) }
  }

  /** A media record as the view carries it: materials joined, focus time derived. */
  function mediaView(record: MediaRecord): MediaView {
    return {
      ...record,
      materials: record.materials.map(materialView),
      focusSeconds: focusSeconds(record.focusSessions),
    }
  }

  /**
   * Delete the assets a departing entry's image materials referenced.
   *
   * Called *after* the record is gone: a crash in between leaves an orphan
   * asset, which {@link HabitStore.sweepOrphanAssets} can find, whereas the
   * other order would leave a material pointing at nothing and draw a broken
   * image on the board.
   */
  async function dropAssetsOf(record: RegistryRecord | undefined): Promise<void> {
    if (record === undefined) return
    for (const material of record.materials) {
      if (material.kind === 'image') await assets.delete(material.assetId)
    }
  }

  const store: HabitStore = {
    readDay: key => days.get(key),

    dayFacts(key) {
      const record = effective(key)
      const due = dueTasksOn(key)
      return {
        date: key,
        stored: days.get(key) ?? null,
        day: record,
        target: copyTarget(record.vocab?.target ?? config.defaultVocabTarget),
        vocab: vocabProgress(record) ?? NO_PROGRESS,
        cells: dayCells(record, due),
        progress: cellProgress(record, due),
        perfect: isPerfectDay(record, due),
      }
    },

    resolveTarget,

    view(key, today) {
      const facts = store.dayFacts(key)
      return {
        day: {
          date: key,
          isToday: key === today,
          day: facts.stored,
          target: facts.target,
          vocab: facts.vocab,
          cells: facts.cells,
          progress: facts.progress,
        },
        stock: stock(),
        media: byCreatedAtDesc([...media.entries()].map(([, record]) => record)).map(mediaView),
        tasks: byCreatedAtDesc([...tasks.entries()].map(([, record]) => record)).map(record => ({
          ...record,
          state: taskState(record),
          overdue: isOverdue(record, today),
          materials: record.materials.map(materialView),
          focusSeconds: focusSeconds(record.focusSessions),
        })),
      }
    },

    async mutateDay(key, apply) {
      await materialize(key)
      return await days.update(key, current => dayRecord.parse(apply(current)))
    },

    addCheck(key, habit, at) {
      // The cap lives *inside* the read-modify-write. Outside it, two taps both
      // read the count before either wrote and a third wash lands — the one
      // thing this store promises cannot happen.
      return store.mutateDay(key, (day) => {
        if (habit === 'shower') {
          if (day.shower.at !== null) throw new ApiError(409, 'habit/check-limit', CHECK_LIMIT_MESSAGE.shower)
          return { ...day, shower: { at } }
        }
        if (day.washes.times.length >= checkLimitOf(habit)) {
          throw new ApiError(409, 'habit/check-limit', CHECK_LIMIT_MESSAGE.wash)
        }
        return { ...day, washes: { times: [...day.washes.times, at] } }
      })
    },

    retimeCheck(key, habit, at, index) {
      return store.mutateDay(key, (day) => {
        if (habit === 'shower') {
          if (day.shower.at === null) throw new ApiError(404, 'habit/not-found', '洗澡尚未打卡')
          return { ...day, shower: { at } }
        }
        const times = day.washes.times
        const target = index ?? times.length - 1
        if (target < 0 || target >= times.length) throw new ApiError(404, 'habit/not-found', '没有这条打卡')
        return {
          ...day,
          washes: { times: times.map((instant, position) => (position === target ? at : instant)) },
        }
      })
    },

    removeCheck(key, habit, index) {
      return store.mutateDay(key, (day) => {
        if (habit === 'shower') return { ...day, shower: { at: null } }
        const times = [...day.washes.times]
        const target = index ?? times.length - 1
        if (target >= 0 && target < times.length) times.splice(target, 1)
        return { ...day, washes: { times } }
      })
    },

    setVocabTarget(key, target) {
      return store.mutateDay(key, day => ({
        ...day,
        vocab: { target: copyTarget(target), sessions: day.vocab?.sessions ?? [] },
      }))
    },

    addSession(key, kind, entry) {
      const id = randomUUID()
      return store.mutateDay(key, day =>
        withSessions(day, kind, key, [...sessionsOf(day, kind), { ...entry, id }]))
    },

    patchSession(key, kind, id, patch) {
      return store.mutateDay(key, day => withSessions(day, kind, key,
        sessionsOf(day, kind).map(session => (session.id === id ? { ...session, ...patch, id } : session))))
    },

    removeSession(key, kind, id) {
      return store.mutateDay(key, day => withSessions(day, kind, key,
        sessionsOf(day, kind).filter(session => session.id !== id)))
    },

    async wash(key, pieces, at) {
      // History first (the fact), then the gauge: a crash in between
      // under-counts the stock rather than inventing a wash that never happened.
      const day = await store.addSession(key, 'washing', { at, pieces })
      const next = { pending: Math.max(0, stock().pending - pieces), updatedAt: at }
      await counters.put(LAUNDRY_KEY, next)
      return { day, stock: next }
    },

    async setStock(pending, at) {
      const next = { pending, updatedAt: at }
      await counters.put(LAUNDRY_KEY, next)
      return next
    },

    putMedia: record => media.put(record.id, record),

    patchMedia: (id, patch) => media.update(id, (current) => {
      const parsed = mediaRecord.parse(withoutCleared({ ...current, ...patch, id }))
      // Symmetric with tasks: the instant a title was finished is a fact the
      // store keeps in step with the status, not something callers must send.
      if (parsed.status === 'done' && parsed.finishedAt === undefined) {
        return { ...parsed, finishedAt: now().toISOString() }
      }
      if (parsed.status !== 'done' && parsed.finishedAt !== undefined) {
        const { finishedAt: _cleared, ...rest } = parsed
        return rest
      }
      return parsed
    }),

    deleteMedia: async (id) => {
      const record = media.get(id)
      const removed = await media.delete(id)
      await dropAssetsOf(record)
      return removed
    },

    putTask: async input => {
      // Parsed here rather than trusted: callers hand over a record they
      // built, and the schema is where a task's defaults (empty checkpoints,
      // zero progress) come from — the same treatment `patchTask` gives its
      // merge result.
      const record = taskRecord.parse(input)
      assertCheckpointsFit(record)
      await tasks.put(record.id, syncCheckpoints(record, now))
    },

    patchTask: (id, patch) => tasks.update(id, (current) => {
      const merged: Record<string, unknown> = { ...current, ...patch, id }
      // `progress` merges field by field; every other key replaces wholesale.
      if (patch.progress !== undefined && patch.progress !== null) {
        merged.progress = withoutCleared({
          ...current.progress,
          ...(patch.progress as Record<string, unknown>),
        })
      }
      // A checkpoint's identity to the user is its content — `label` plus
      // `at` — so the wire carries no ids: a line that still exists keeps its
      // id and its reached fact, and a changed or new line starts fresh.
      if (Array.isArray(patch.checkpoints)) {
        merged.checkpoints = (patch.checkpoints as { label: string; at: number }[]).map((line) => {
          const before = current.checkpoints.find(
            checkpoint => checkpoint.label === line.label && checkpoint.at === line.at,
          )
          return before === undefined
            ? { ...line, id: randomUUID() }
            : { ...line, id: before.id, reachedAt: before.reachedAt }
        })
      }
      const parsed = taskRecord.parse(withoutCleared(merged))
      assertCheckpointsFit(parsed)
      // Completion is derived from progress, so the instant it happened is kept
      // in step here rather than trusted from every caller.
      let task: TaskRecord = parsed
      const done = taskState(task) === 'done'
      if (done && task.completedAt === undefined) {
        task = { ...task, completedAt: now().toISOString() }
      } else if (!done && task.completedAt !== undefined) {
        const { completedAt: _cleared, ...rest } = task
        task = rest
      }
      return syncCheckpoints(task, now)
    }),

    deleteTask: async (id) => {
      const record = tasks.get(id)
      const removed = await tasks.delete(id)
      await dropAssetsOf(record)
      return removed
    },

    addMaterialText: async (owner, id, text) => {
      await updateRegistry(owner, id, record => ({
        ...record,
        materials: [...record.materials, { kind: 'md', id: randomUUID(), text }],
      }))
    },

    addMaterialImage: async (owner, id, image) => {
      const assetId = randomUUID()
      const createdAt = now().toISOString()
      // Bytes first: a failure between the two writes leaves an orphan asset,
      // which the sweep reclaims, rather than a material pointing at nothing.
      await assets.put(assetId, assetRecord.parse({
        id: assetId,
        mime: image.mime,
        data: image.data,
        createdAt,
      }))
      await updateRegistry(owner, id, record => ({
        ...record,
        materials: [...record.materials, {
          kind: 'image',
          id: randomUUID(),
          assetId,
          createdAt,
          ...(image.name === undefined ? {} : { name: image.name }),
        }],
      }))
    },

    patchMaterialText: async (owner, id, materialId, text) => {
      await updateRegistry(owner, id, record => ({
        ...record,
        materials: record.materials.map(material =>
          material.kind === 'md' && material.id === materialId ? { ...material, text } : material),
      }))
    },

    removeMaterial: async (owner, id, materialId) => {
      // Read the reference before the write: once the material is gone, the
      // asset id it pointed at is unrecoverable from the record.
      const before = registryTable(owner).get(id)
      const gone = before?.materials.find(material => material.id === materialId)
      await updateRegistry(owner, id, record => ({
        ...record,
        materials: record.materials.filter(material => material.id !== materialId),
      }))
      if (gone?.kind === 'image') await assets.delete(gone.assetId)
    },

    readAsset: assetId => assets.get(assetId),

    startFocus: async (owner, id) => {
      const startedAt = now().toISOString()
      const sessionId = randomUUID()
      await updateRegistry(owner, id, record => ({
        ...record,
        // A session a crash left open has no honest end, so it is dropped
        // rather than closed at a guessed instant.
        focusSessions: [
          ...record.focusSessions.filter(session => session.endedAt !== undefined),
          { id: sessionId, startedAt },
        ],
      }))
      // The id travels back so the caller can close exactly this session
      // instead of inferring "the open one" from the list it is shown.
      return sessionId
    },

    endFocus: async (owner, id, sessionId) => {
      const endedAt = now().toISOString()
      await updateRegistry(owner, id, record => ({
        ...record,
        // Closing an unknown or already-closed session is a no-op, not a fault:
        // a second window may have finished it already.
        focusSessions: record.focusSessions.map(session =>
          session.id === sessionId && session.endedAt === undefined ? { ...session, endedAt } : session),
      }))
    },

    sweepOrphanAssets: async () => {
      const referenced = new Set<string>()
      for (const table of [tasks, media]) {
        for (const [, record] of table.entries()) {
          for (const material of record.materials) {
            if (material.kind === 'image') referenced.add(material.assetId)
          }
        }
      }
      let removed = 0
      for (const [assetId] of [...assets.entries()]) {
        if (referenced.has(assetId)) continue
        if (await assets.delete(assetId)) removed += 1
      }
      return removed
    },

    newId: () => randomUUID(),
  }

  return store
}
