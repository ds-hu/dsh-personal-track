/**
 * The habit storage domain: one schema-validated KV domain named `habit`,
 * laid out `per-record` so each habit day is its own JSON document.
 *
 * Only facts are stored — instants, metrics, entries, material bytes, and the
 * laundry stock. Every state derived from them (cells, target progress, task
 * state, overdue, pace, streaks, focus durations, image sizes) is computed on
 * read; see docs/adr/0002-derived-state-not-stored.md.
 */
import { z } from 'zod'
import { defineDomain, domainTable, type Domain } from '@deepseek-ai/dsh-storage-domain'
import type { DayKey } from '../shared/habit-day.ts'

/** Every session entry carries a stable id so edits never address by index. */
const sessionId = z.string().min(1)

/** One meal slot: when it was eaten, optionally what it cost. */
const mealSlot = z.object({
  at: z.string(),
  price: z.number().nonnegative().optional(),
})

/** Vocabulary target snapshot for one habit day. */
const vocabTarget = z.object({
  new: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
})

/** One vocabulary study session. */
const vocabSession = z.object({
  id: sessionId,
  at: z.string(),
  new: z.number().int().nonnegative(),
  review: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
})

/** Everything one habit day holds. Fields are optional/defaulted so older
 *  documents keep parsing as the schema grows. */
export const dayRecord = z.object({
  /** Copy of the key, so a document is self-describing. */
  date: z.string(),
  /** Check: at most two washes, one instant each. */
  washes: z.object({ times: z.array(z.string()).default([]) }).default({ times: [] }),
  /** Check: at most one shower. */
  shower: z.object({ at: z.string().nullable().default(null) }).default({ at: null }),
  /** Slot: three meals, each at most once. */
  meals: z.object({
    breakfast: mealSlot.optional(),
    lunch: mealSlot.optional(),
    dinner: mealSlot.optional(),
  }).default({}),
  /** Session with a quantity target (vocabulary). */
  vocab: z.object({
    target: vocabTarget,
    sessions: z.array(vocabSession).default([]),
  }).optional(),
  /** Session with a presence target (at least one lesson). */
  duolingo: z.array(z.object({
    id: sessionId,
    at: z.string(),
    minutes: z.number().nonnegative(),
  })).default([]),
  /** Session capped at one per day (running). */
  run: z.object({
    at: z.string(),
    minutes: z.number().positive(),
    distanceKm: z.number().nonnegative(),
    avgHr: z.number().int().positive().optional(),
  }).nullable().default(null),
  /** Repetitive sessions (jump rope). */
  rope: z.array(z.object({
    id: sessionId,
    at: z.string(),
    preset: z.union([z.literal(90), z.literal(180)]),
    seconds: z.number().nonnegative(),
    avgHr: z.number().int().positive().optional(),
  })).default([]),
  /** Repetitive sessions (pull-ups, metric = support time). */
  pullup: z.array(z.object({
    id: sessionId,
    at: z.string(),
    seconds: z.number().nonnegative(),
  })).default([]),
  /** Repetitive sessions (plank, metric = hold time). */
  plank: z.array(z.object({
    id: sessionId,
    at: z.string(),
    seconds: z.number().nonnegative(),
  })).default([]),
  /** Repetitive sessions (gym equipment). */
  equipment: z.array(z.object({
    id: sessionId,
    at: z.string(),
    name: z.string().min(1),
    reps: z.number().int().nonnegative(),
    weight: z.number().nonnegative().optional(),
  })).default([]),
  /**
   * Free-form training: a duration, and the energy it burned when a device knew
   * it. The one training session with no fixed shape, for work that is neither
   * a run nor a set of anything — a swim, a class, a game of ball.
   *
   * `kcal` is optional the way `run.avgHr` is: it is what a watch measured, not
   * something the user can be asked to invent. A session without it still
   * happened.
   */
  free: z.array(z.object({
    id: sessionId,
    at: z.string(),
    minutes: z.number().positive(),
    kcal: z.number().nonnegative().optional(),
  })).default([]),
  /** Washing sessions: the history half of the laundry counter. */
  washing: z.array(z.object({
    id: sessionId,
    at: z.string(),
    pieces: z.number().int().positive(),
  })).default([]),
})

/** One stored habit day. */
export type DayRecord = z.infer<typeof dayRecord>

/** The laundry stock. Authoritative value; washing sessions hold the history. */
export const counterRecord = z.object({
  pending: z.number().int().nonnegative(),
  updatedAt: z.string(),
})

/** The laundry stock record. */
export type CounterRecord = z.infer<typeof counterRecord>

/**
 * One focus session on a registry entry: the fact that someone sat down with
 * this task or title, from one instant to another.
 *
 * Duration is deliberately absent — it is `endedAt − startedAt`, derived on
 * read like every other derived value (docs/adr/0002-derived-state-not-stored.md).
 * `endedAt` is missing only while a session is open; a session left open by a
 * crash is dropped by the next start rather than guessed at.
 */
export const focusSession = z.object({
  id: sessionId,
  startedAt: z.string(),
  endedAt: z.string().optional(),
})

/** One focus session, as stored. */
export type FocusSession = z.infer<typeof focusSession>

/**
 * A Markdown text block among a registry entry's materials.
 *
 * The text lives here rather than in `notes` because materials are an ordered
 * stream that text and images share, while `notes` stays the short remark the
 * board's own form edits.
 */
const materialText = z.object({
  kind: z.literal('md'),
  id: sessionId,
  text: z.string(),
})

/**
 * A pasted image among a registry entry's materials.
 *
 * Only the *reference* is here — the bytes live in the `assets` table, one
 * document per image, so reading a task never drags megabytes along. Size and
 * mime are derived from the asset when a view is built, never stored twice.
 */
const materialImage = z.object({
  kind: z.literal('image'),
  id: sessionId,
  assetId: sessionId,
  name: z.string().optional(),
  createdAt: z.string(),
})

/** One material: text or image, in the order the user added them. */
export const material = z.discriminatedUnion('kind', [materialText, materialImage])

/** One material, as stored. */
export type Material = z.infer<typeof material>

/** Everything a registry entry carries beyond its own shape. */
const registryExtras = {
  /** The ordered material stream: Markdown blocks and pasted images. */
  materials: z.array(material).default([]),
  /** Focus sessions spent on this entry; duration derived, never stored. */
  focusSessions: z.array(focusSession).default([]),
}

/** One media log entry (log-shaped registry). */
export const mediaRecord = z.object({
  id: sessionId,
  kind: z.enum(['film', 'book']),
  title: z.string().min(1),
  status: z.enum(['active', 'done', 'dropped']),
  rating: z.number().int().min(1).max(5).optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  ...registryExtras,
})

/** One media entry. */
export type MediaRecord = z.infer<typeof mediaRecord>

/**
 * One named stage on a task's progress axis (a checkpoint).
 *
 * `at` shares the task's counting unit (problems, words, chapters), and
 * "reached" is always derived from `progress.current ≥ at` — never stored.
 * `reachedAt` is the fact the host keeps in step, exactly like `completedAt`.
 */
const taskCheckpoint = z.object({
  id: sessionId,
  label: z.string().min(1),
  at: z.number().int().positive(),
  reachedAt: z.string().optional(),
})

/** One checkpoint. */
export type TaskCheckpoint = z.infer<typeof taskCheckpoint>

/** One task (task-shaped registry: title, optional category/due, progress). */
export const taskRecord = z.object({
  id: sessionId,
  title: z.string().min(1),
  category: z.string().optional(),
  /** Due date as a plain `YYYY-MM-DD`; overdue-ness is derived, never stored. */
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'due must be YYYY-MM-DD').optional(),
  progress: z.object({
    current: z.number().int().nonnegative().default(0),
    total: z.number().int().positive().optional(),
  }).default({ current: 0 }),
  /** Named stages on the progress axis; only a task with a total may hold any. */
  checkpoints: z.array(taskCheckpoint).default([]),
  completedAt: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  ...registryExtras,
})

/** One task. */
export type TaskRecord = z.infer<typeof taskRecord>

/** Either kind of registry entry, as stored. */
export type RegistryRecord = MediaRecord | TaskRecord

/**
 * One stored image: the only place material bytes live.
 *
 * Base64 inside a per-record JSON document, which is what keeps images inside
 * the domain's own schema validation, per-record layout and backup round-trip
 * (docs/adr/0003-assets-in-domain-as-base64.md). There is no owner field: the
 * entry that references this id through `materialImage.assetId` *is* the owner,
 * so cascade delete and the orphan sweep read that reference instead of
 * maintaining a second, driftable copy of the relationship.
 */
export const assetRecord = z.object({
  id: sessionId,
  mime: z.string().min(1),
  /** Base64 payload. Its size is derived from this, never stored beside it. */
  data: z.string().min(1),
  createdAt: z.string(),
})

/** One stored image. */
export type AssetRecord = z.infer<typeof assetRecord>

/**
 * The domain declaration: identity, layout and record schemas.
 *
 * `version: 2` adds the `assets` table plus `materials`/`focusSessions` on the
 * registry records. All three are additive and optional-with-defaults, so a
 * version 1 document still parses — which is exactly what
 * `compatibleVersions: [1]` vouches for. Without it a `per-record` backend
 * *discards* every document stamped 1 (it never migrates), and a year of habit
 * days would disappear on the first restart after this change.
 *
 * The `free` session array did **not** bump this to 3, on purpose. A new
 * optional-with-default field needs no version of its own: a document stamped 2
 * still parses here, and a build from before it simply drops the field. Bumping
 * would be the dangerous move — a per-record backend discards a document whose
 * version it does not accept, so rolling back to the previous code would delete
 * every day written by the newer one. The backup file carries the layout that
 * does need a version (see `BACKUP_VERSION`), because there the alternative to a
 * version is silently stripping a field.
 */
export const habitDomainSpec = defineDomain({
  name: 'habit',
  version: 2,
  compatibleVersions: [1],
  layout: 'per-record',
  tables: {
    days: domainTable<DayKey, DayRecord>(dayRecord),
    counters: domainTable<'laundry', CounterRecord>(counterRecord),
    media: domainTable<string, MediaRecord>(mediaRecord),
    tasks: domainTable<string, TaskRecord>(taskRecord),
    assets: domainTable<string, AssetRecord>(assetRecord),
  },
})

/** The opened handle this domain's consumers hold. */
export type HabitDomain = Domain<typeof habitDomainSpec>
