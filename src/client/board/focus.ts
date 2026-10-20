/**
 * Focus mode's shared, browser-free rules.
 *
 * What lives here is what both the column and the overlay need and neither
 * should own twice: how a pinned item is remembered, how a duration reads, and
 * how an entry is addressed. Keeping it free of React and of the DOM is also
 * what makes it assertable in Node, next to the board's other pure modules.
 */
import type { FocusSession, MediaEntry, RegistryKind, StateView, TaskEntry } from '../types.ts'

/** Either registry entry, as the focus surfaces handle them. */
export type RegistryEntry = TaskEntry | MediaEntry

/**
 * The item the focus column is showing.
 *
 * A reference, not a copy: the entry itself stays in the registry, so the
 * column always renders whatever the host last said about it.
 */
export interface Pinned {
  readonly kind: RegistryKind
  readonly id: string
}

/** The slice of `localStorage` these rules need — so a test can pass a map. */
export interface PinStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Where the pinned item is remembered. Presentation state, not domain data. */
export const PINNED_KEY = 'personal-track/focus-pinned'

/** Read the pinned item, ignoring anything malformed. */
export function readPinned(storage: PinStorage): Pinned | null {
  const raw = storage.getItem(PINNED_KEY)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Partial<Pinned> | null
    if (parsed === null || typeof parsed !== 'object') return null
    if (parsed.kind !== 'task' && parsed.kind !== 'media') return null
    if (typeof parsed.id !== 'string' || parsed.id === '') return null
    return { kind: parsed.kind, id: parsed.id }
  } catch {
    return null
  }
}

/** Remember the pinned item, or forget it with `null`. */
export function writePinned(storage: PinStorage, pinned: Pinned | null): void {
  if (pinned === null) {
    storage.removeItem(PINNED_KEY)
    return
  }
  storage.setItem(PINNED_KEY, JSON.stringify(pinned))
}

/** Which registry an entry came from — the entry itself carries the answer. */
export function kindOf(entry: RegistryEntry): RegistryKind {
  return 'state' in entry ? 'task' : 'media'
}

/** The pinned reference for an entry. */
export function pinnedOf(entry: RegistryEntry): Pinned {
  return { kind: kindOf(entry), id: entry.id }
}

/**
 * Whether the pinned entry no longer earns the column's card.
 *
 * A completed task stays in the registry — finishing is not deleting — but it
 * has nothing left for a "最近专注" card to offer, and the only way out of the
 * column used to be the user pressing ×. Media is deliberately left out: a
 * finished film is answered business too, but the ask was about tasks, and
 * keeping the rule to one derived state keeps it about **任务状态** rather than a
 * second opinion on media's three.
 */
export function pinShouldRetire(entry: RegistryEntry): boolean {
  return 'state' in entry && entry.state === 'done'
}

/** The session still running, if any. */
export function openSession(sessions: readonly FocusSession[]): FocusSession | undefined {
  return sessions.find(session => session.endedAt === undefined)
}

/**
 * Whether a registry answer is the *entry view*, not the stored record.
 *
 * A registry's record and its view are different shapes: the view adds what the
 * entry cannot know by itself — an image material's mime and byte size, both
 * derived from the asset table, and the derived `focusSeconds` every entry
 * carries — while the record is only what storage holds. The two halves of the
 * plugin update separately (the browser bundle hot reloads, the host half needs
 * a `dsh` restart), so an older host can hand this bundle a record; adopting it
 * as the entry would draw every image on that entry as missing and its focus
 * total as no time at all. `focusSeconds` is the field to ask about because
 * *both* registry views carry it and no stored record does.
 */
export function isEntryView(value: unknown): value is RegistryEntry {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { focusSeconds?: unknown }).focusSeconds === 'number'
}

/**
 * A state slice with one entry replaced by the view a write answered with.
 *
 * The overlay hands its entry back when the mode is left; adopting it into the
 * panel's slice is what makes the column react in that same frame instead of
 * after a round trip. What comes back is a view (see {@link isEntryView}), so
 * replacing a record with it is safe to draw. An entry the slice does not hold —
 * a snapshot taken before it was added — leaves the slice untouched: inventing a
 * slot for it would show an entry in a list the host never put it in, and the
 * caller's re-read is what fills it in.
 */
export function withEntry(state: StateView, entry: RegistryEntry): StateView {
  if ('state' in entry) {
    if (!state.tasks.some(task => task.id === entry.id)) return state
    return { ...state, tasks: state.tasks.map(task => (task.id === entry.id ? entry : task)) }
  }
  if (!state.media.some(item => item.id === entry.id)) return state
  return { ...state, media: state.media.map(item => (item.id === entry.id ? entry : item)) }
}

/**
 * A duration as `m:ss`, or `h:mm:ss` once it passes an hour.
 *
 * Seconds are the stored unit (they are what instants subtract to), and this is
 * the only place they become something readable.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** The current clock time as `HH:mm`. */
export function clockLabel(at: Date): string {
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** The current clock time with its weekday: `HH:mm · 周三`. */
export function nowLabel(at: Date): string {
  const week = '日一二三四五六'[at.getDay()] ?? ''
  return `${clockLabel(at)} · 周${week}`
}
