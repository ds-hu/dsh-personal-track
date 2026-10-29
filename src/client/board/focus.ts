/**
 * Focus mode's shared, browser-free rules.
 *
 * What lives here is what both the column and the overlay need and neither
 * should own twice: how an entry is addressed, how a duration reads, and how a
 * write's answer is adopted. Keeping it free of React and of the DOM is also
 * what makes it assertable in Node, next to the board's other pure modules.
 *
 * What is *not* here any more is the pinned item. The column used to remember
 * one browser-local reference, with no instant attached — it answered "which
 * entry did this browser open last", not "what did I focus on last". That is a
 * derived fact now (`recentFocus` in `src/shared/focus-session.ts`), so the only
 * focus state left in the panel is the in-memory target of an open overlay.
 */
import type { MediaEntry, RegistryKind, StateView, TaskEntry } from '../types.ts'

/** Either registry entry, as the focus surfaces handle them. */
export type RegistryEntry = TaskEntry | MediaEntry

/**
 * The entry focus mode is open on, right now.
 *
 * A reference, not a copy: the entry itself stays in the registry, so every
 * surface always renders whatever the host last said about it. In memory only —
 * it exists for as long as the overlay does.
 */
export interface FocusTarget {
  readonly kind: RegistryKind
  readonly id: string
}

/** Which registry an entry came from — the entry itself carries the answer. */
export function kindOf(entry: RegistryEntry): RegistryKind {
  return 'state' in entry ? 'task' : 'media'
}

/** The focus target for an entry. */
export function targetOf(entry: RegistryEntry): FocusTarget {
  return { kind: kindOf(entry), id: entry.id }
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

/**
 * When a session happened, as `MM-DD HH:mm` in the reader's own zone.
 *
 * Deliberately not "今天": a session belongs to the **habit day** it started on,
 * and the browser half does not know the host's configured `timezone` — reading
 * one off the local calendar is exactly the class of bug
 * docs/adr/0005-shared-habit-day.md records. A date plus a clock time is honest
 * with what the browser knows; the duration beside it is zone-free anyway.
 */
export function sessionStamp(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${clockLabel(at)}`
}
