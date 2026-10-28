/**
 * The browser half's view of the wire contract.
 *
 * These are display shapes, deliberately declared here rather than imported
 * from the host program: the two halves are separate TypeScript programs (the
 * host one owns Node and zod, the browser one owns JSX and the DOM), and the
 * JSON on the wire is the real interface between them.
 */

/**
 * One cell of the day's completion bar.
 *
 * `value` is a fraction, not a flag: vocabulary reports its weighted target
 * progress and a task due that day reports how far along it is, so the bar can
 * read `4.5/9`. `label` comes from the host, which owns the habit names and
 * knows each task's title.
 */
export interface Cell {
  /** A habit cell id, or `task:<id>` for a task due on the day. */
  readonly id: string
  readonly label: string
  /** Fraction in `[0,1]`: 0 untouched, 1 complete, between = partial. */
  readonly value: number
}

/** Vocabulary target progress for a day. */
export interface VocabProgress {
  readonly doneNew: number
  readonly doneReview: number
  readonly targetNew: number
  readonly targetReview: number
  readonly minutes: number
  readonly ratio: number
  readonly surplusNew: number
  readonly surplusReview: number
  readonly met: boolean
}

/** One meal slot. */
export interface Meal {
  readonly at: string
  readonly price?: number
}

/** A vocabulary study session. Declared as a type alias (not an interface) so
 *  it stays assignable to the generic session-entry shape. */
export type VocabSession = {
  readonly id: string
  readonly at: string
  readonly new: number
  readonly review: number
  readonly minutes: number
}

/** A duolingo lesson. */
export type Lesson = {
  readonly id: string
  readonly at: string
  readonly minutes: number
}

/** A washing session (the history half of the laundry counter). */
export interface Washing {
  readonly id: string
  readonly at: string
  readonly pieces: number
}

/** A jump-rope session. */
export type RopeSession = {
  readonly id: string
  readonly at: string
  readonly preset: 90 | 180
  readonly seconds: number
  readonly avgHr?: number
}

/** A pull-up session (metric = support time). */
export type PullupSession = {
  readonly id: string
  readonly at: string
  readonly seconds: number
}

/** A plank session (metric = hold time). */
export type PlankSession = {
  readonly id: string
  readonly at: string
  readonly seconds: number
}

/** A gym-equipment session. */
export type EquipmentSession = {
  readonly id: string
  readonly at: string
  readonly name: string
  readonly reps: number
  readonly weight?: number
}

/**
 * A free-form training session: a duration, plus the energy a device measured.
 *
 * The one training record with no fixed shape of its own, for work that is
 * neither a run nor a set of anything. `kcal` is absent when no device said —
 * an unmeasured workout still happened.
 */
export type FreeSession = {
  readonly id: string
  readonly at: string
  readonly minutes: number
  readonly kcal?: number
}

/** The stored document for one habit day, as the UI reads it. */
export interface DayRecord {
  readonly date: string
  readonly washes: { readonly times: readonly string[] }
  readonly shower: { readonly at: string | null }
  readonly meals: {
    readonly breakfast?: Meal
    readonly lunch?: Meal
    readonly dinner?: Meal
  }
  readonly vocab?: {
    readonly target: { readonly new: number; readonly review: number }
    readonly sessions: readonly VocabSession[]
  }
  readonly duolingo: readonly Lesson[]
  readonly rope: readonly RopeSession[]
  readonly pullup: readonly PullupSession[]
  readonly plank: readonly PlankSession[]
  readonly equipment: readonly EquipmentSession[]
  readonly free: readonly FreeSession[]
  readonly run: {
    readonly at: string
    readonly minutes: number
    readonly distanceKm: number
    readonly avgHr?: number
  } | null
  readonly washing: readonly Washing[]
}

/** One habit day plus everything derived from it. */
export interface DayView {
  readonly date: string
  readonly isToday: boolean
  readonly day: DayRecord | null
  readonly target: { readonly new: number; readonly review: number }
  readonly vocab: VocabProgress
  readonly cells: readonly Cell[]
  readonly progress: { readonly done: number; readonly total: number }
}

/** The laundry stock. */
export interface Stock {
  readonly pending: number
  readonly updatedAt: string
}

/** One focus session, as the wire carries it: instants only. */
export interface FocusSession {
  readonly id: string
  readonly startedAt: string
  /** Absent only while the session is open. */
  readonly endedAt?: string
}

/** A Markdown text block among an entry's materials. */
export interface MaterialText {
  readonly kind: 'md'
  readonly id: string
  readonly text: string
}

/**
 * A pasted image among an entry's materials.
 *
 * `mime` and `bytes` are derived by the host from the asset document; both are
 * absent when the asset itself is missing, which the board draws as a missing
 * material rather than as an empty image.
 */
export interface MaterialImage {
  readonly kind: 'image'
  readonly id: string
  readonly assetId: string
  readonly name?: string
  readonly createdAt: string
  readonly mime?: string
  readonly bytes?: number
}

/** One material: text or image, in the order they were added. */
export type Material = MaterialText | MaterialImage

/** Which registry a material or focus session belongs to. */
export type RegistryKind = 'task' | 'media'

/** One media log entry. */
export interface MediaEntry {
  readonly id: string
  readonly kind: 'film' | 'book'
  readonly title: string
  readonly status: 'active' | 'done' | 'dropped'
  readonly rating?: number
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly notes?: string
  readonly createdAt: string
  readonly materials: readonly Material[]
  readonly focusSessions: readonly FocusSession[]
  /** Derived: seconds focused on this entry, closed sessions only. */
  readonly focusSeconds: number
}

/** A task's lifecycle state, derived by the host from its progress. */
export type TaskState = 'todo' | 'doing' | 'done'

/**
 * One named stage on a task's progress axis.
 *
 * Reached-ness is not in here: it is `progress.current >= at`, read off the
 * entry the way every other derived value is.
 */
export interface TaskCheckpoint {
  readonly id: string
  readonly label: string
  /** Position on the integer progress axis, in the task's counting unit. */
  readonly at: number
  /** Fact: when `current` first reached `at`; the host keeps it in step. */
  readonly reachedAt?: string
}

/** One task entry: the record plus both states the host derives from it. */
export interface TaskEntry {
  readonly id: string
  readonly title: string
  readonly category?: string
  readonly due?: string
  readonly progress: { readonly current: number; readonly total?: number }
  readonly checkpoints: readonly TaskCheckpoint[]
  readonly completedAt?: string
  readonly notes?: string
  readonly createdAt: string
  readonly materials: readonly Material[]
  readonly focusSessions: readonly FocusSession[]
  /** Derived: seconds focused on this entry, closed sessions only. */
  readonly focusSeconds: number
  /** Derived: 待办 / 进行中 / 完成. */
  readonly state: TaskState
  /** Derived: past its due date and not finished. */
  readonly overdue: boolean
}

/** A task as a backup file carries it: the stored record, without the states
 *  and derived totals the host computes for the live view. */
export type TaskRecordWire = Omit<TaskEntry, 'state' | 'overdue' | 'focusSeconds'>

/** A media entry as a backup file carries it: stored facts only. */
export type MediaRecordWire = Omit<MediaEntry, 'focusSeconds'>

/** How an import treats what is already stored. */
export type ImportMode = 'merge' | 'replace'

/**
 * One backup file: stored facts only. Nothing derived (cells, ratios, streaks,
 * overdue flags, focus durations, image sizes) is in here, so a restored file
 * cannot contradict itself.
 */
export interface BackupBundle {
  readonly format: string
  readonly version: number
  readonly exportedAt: string
  readonly days: readonly DayRecord[]
  readonly counters: Readonly<Record<string, Stock>>
  readonly media: readonly MediaRecordWire[]
  readonly tasks: readonly TaskRecordWire[]
  /** Material image bytes; absent in a version 1 file, which carries none. */
  readonly assets?: readonly AssetBundleEntry[]
}

/** One image inside a backup file: the bytes travel with the file. */
export interface AssetBundleEntry {
  readonly id: string
  readonly mime: string
  /** Base64 payload. */
  readonly data: string
  readonly createdAt: string
}

/** What one import did. */
export interface ImportReport {
  readonly mode: ImportMode
  readonly days: number
  readonly media: number
  readonly tasks: number
  readonly counters: number
  readonly assets: number
  /** Records dropped because `replace` cleared keys the file did not carry. */
  readonly removed: number
}

/** The state slice an import answers with. */
export type ImportResult = StateView & { readonly ok: true; readonly report: ImportReport }

/** The full state slice every read and mutation answers with. */
export interface StateView {
  readonly day: DayView
  readonly stock: Stock
  readonly media: readonly MediaEntry[]
  readonly tasks: readonly TaskEntry[]
}

/** Host facts about the habit day, fetched once per board mount. */
export interface ClockView {
  readonly today: string
  readonly nightTail: boolean
  readonly now: string
  readonly config: {
    readonly dayStartHour: number
    readonly defaultVocabTarget: { readonly new: number; readonly review: number }
    readonly defaultRunMinutes: number
  }
}

/** One habit's record across a statistics range. */
export interface HabitStats {
  readonly id: string
  /**
   * The habit's display name, from the host's habit inventory.
   *
   * Absent when the host half is older than this bundle (it sent the id alone),
   * which the panel falls back to the id for — the two halves update separately.
   */
  readonly label?: string
  readonly met: number
  readonly days: number
  readonly ratio: number
  readonly streak: number
  /** One flag per day, aligned with {@link StatsView.days}. */
  readonly perDay: readonly boolean[]
}

/** One day's completion, for the heat grid. */
export interface DayStats {
  readonly date: string
  readonly done: number
  readonly total: number
  readonly stored: boolean
}

/** One run, as a point on the heart-rate / pace curve. */
export interface RunPoint {
  readonly date: string
  readonly pace: number
  readonly avgHr: number
  readonly km: number
  readonly minutes: number
}

/** A media entry as the statistics panel lists it. */
export interface MediaSummary {
  readonly id: string
  readonly kind: 'film' | 'book'
  readonly title: string
  readonly status: 'active' | 'done' | 'dropped'
  readonly rating?: number
  readonly finishedAt?: string
}

/** The statistics panel's data, computed entirely on the host. */
export interface StatsView {
  readonly from: string
  readonly to: string
  readonly days: readonly DayStats[]
  readonly habits: readonly HabitStats[]
  readonly perfectDays: number
  readonly vocab: {
    readonly new: number
    readonly review: number
    readonly minutes: number
    readonly daysMet: number
    readonly surplus: number
  }
  readonly duolingo: { readonly lessons: number; readonly minutes: number; readonly daysMet: number }
  readonly runs: {
    readonly count: number
    readonly km: number
    readonly avgHr?: number
    readonly points: readonly RunPoint[]
  }
  readonly rope: {
    readonly sets: number
    readonly sets90: number
    readonly sets180: number
    readonly seconds: number
    readonly avgHr?: number
  }
  readonly pullup: { readonly sets: number; readonly seconds: number }
  readonly plank: { readonly sets: number; readonly seconds: number }
  readonly equipment: {
    readonly sets: number
    readonly reps: number
    /** One entry per (name, weight); a machine at another weight is another entry. */
    readonly byName: readonly {
      readonly name: string
      readonly weight?: number
      readonly sets: number
      readonly reps: number
    }[]
  }
  /**
   * Free-form training over the range.
   *
   * `kcal` sums only the sessions that carried a reading, and `kcalSessions`
   * says how many those were — so "burned nothing" and "was not measured" stay
   * distinguishable.
   */
  readonly free: {
    readonly sessions: number
    readonly minutes: number
    readonly kcal: number
    readonly kcalSessions: number
  }
  readonly washing: { readonly count: number; readonly pieces: number }
  readonly meals: {
    /** Only breakfast is projected: the panel keeps this card short. */
    readonly breakfast: { readonly days: number; readonly ratio: number }
    readonly spend: number
  }
  readonly media: {
    readonly finished: number
    readonly films: number
    readonly books: number
    readonly active: number
    readonly dropped: number
    readonly avgRating?: number
    readonly recently: readonly MediaSummary[]
  }
  readonly tasks: {
    readonly done: number
    readonly doneLate: number
    readonly open: number
    readonly doing: number
    readonly overdue: number
  }
  /** Focus time over both registries: closed sessions that started in range. */
  readonly focus: {
    readonly seconds: number
    readonly sessions: number
  }
}
