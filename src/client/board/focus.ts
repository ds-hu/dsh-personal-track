/**
 * Focus mode's shared, browser-free rules.
 *
 * What lives here is what both the column and the overlay need and neither
 * should own twice: how a pinned item is remembered, how a duration reads, and
 * how an entry is addressed. Keeping it free of React and of the DOM is also
 * what makes it assertable in Node, next to the board's other pure modules.
 */
import type { FocusSession, MediaEntry, RegistryKind, TaskEntry } from '../types.ts'

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

/** The session still running, if any. */
export function openSession(sessions: readonly FocusSession[]): FocusSession | undefined {
  return sessions.find(session => session.endedAt === undefined)
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
