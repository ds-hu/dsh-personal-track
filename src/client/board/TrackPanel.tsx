/**
 * The plugin's one surface: 打卡 and 统计, with the focus column on the left of
 * the board view.
 *
 * The panel owns what both views and the focus surfaces need — the registry
 * snapshot, the clock, and which item is pinned or open — while the board keeps
 * owning its own shown day. Focus mode itself is an overlay rendered from here,
 * over whichever view is up.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { HabitClient } from '../api.ts'
import type { ClockView, StateView } from '../types.ts'
import { BoardBody } from './BoardBody.tsx'
import { FocusColumn } from './FocusColumn.tsx'
import { FocusOverlay } from './FocusOverlay.tsx'
import {
  kindOf,
  pinnedOf,
  pinShouldRetire,
  readPinned,
  withEntry,
  writePinned,
  type PinStorage,
  type Pinned,
  type RegistryEntry,
} from './focus.ts'
import { messageOf } from './format.ts'
import { StatsPanel } from './stats-panel.tsx'
import { Pills } from './tile.tsx'

/** The two views inside the panel. */
type ViewKey = 'board' | 'stats'

const VIEWS: readonly { readonly value: ViewKey; readonly label: string }[] = [
  { value: 'board', label: '打卡' },
  { value: 'stats', label: '统计' },
]

/**
 * `localStorage`, or a memory stand-in when the browser refuses it.
 *
 * A private-mode browser throws on access; the pinned item is presentation
 * state, so losing it is not worth an error path in the UI.
 */
function pinStorage(): PinStorage {
  try {
    const probe = 'personal-track/probe'
    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    const map = new Map<string, string>()
    return {
      getItem: key => map.get(key) ?? null,
      setItem: (key, value) => { map.set(key, value) },
      removeItem: (key) => { map.delete(key) },
    }
  }
}

/** Props handed in by the slot registration's injection face. */
export interface TrackPanelProps {
  readonly client: HabitClient
}

/** Render the panel. */
export function TrackPanel({ client }: TrackPanelProps): JSX.Element {
  const [view, setView] = useState<ViewKey>('board')
  const [snapshot, setSnapshot] = useState<StateView | null>(null)
  const [clock, setClock] = useState<ClockView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pinned, setPinned] = useState<Pinned | null>(() => readPinned(pinStorage()))
  const [focused, setFocused] = useState<Pinned | null>(null)
  /** Bumped when focus mode closes, so the board re-reads the day it shows. */
  const [boardToken, setBoardToken] = useState(0)
  const storage = useRef<PinStorage>(pinStorage())
  /** Reads issued so far, so an older answer cannot overwrite a newer one. */
  const reads = useRef(0)

  /** Re-read everything the column and the overlay are built from. */
  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++reads.current
    try {
      const [nextClock, nextState] = await Promise.all([client.clock(), client.state()])
      // Superseded by a read issued later — that one knows more than this one.
      if (seq !== reads.current) return
      setClock(nextClock)
      setSnapshot(nextState)
      setError(null)
    } catch (cause) {
      if (seq === reads.current) setError(messageOf(cause))
    }
  }, [client])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Coming back to the tab may cross the habit-day boundary or see new writes.
  useEffect(() => {
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const entries: readonly RegistryEntry[] = useMemo(
    () => (snapshot === null ? [] : [...snapshot.tasks, ...snapshot.media]),
    [snapshot],
  )

  const entryFor = useCallback(
    (target: Pinned | null): RegistryEntry | undefined =>
      target === null ? undefined : entries.find(entry => kindOf(entry) === target.kind && entry.id === target.id),
    [entries],
  )

  /** Enter focus mode on one entry, pinning it as the column's item. */
  const openFocus = useCallback((entry: RegistryEntry): void => {
    const target = pinnedOf(entry)
    setPinned(target)
    writePinned(storage.current, target)
    setFocused(target)
  }, [])

  const unpin = useCallback((): void => {
    setPinned(null)
    writePinned(storage.current, null)
  }, [])

  /**
   * Focus mode is over: adopt what it wrote, then let every surface catch up.
   *
   * The three steps are each load-bearing. Adopting the entry synchronously is
   * what makes the column's card show the last write in this very frame; the
   * re-read after it is the host's own word on the same thing, which is allowed
   * to disagree and win. The token is for the board, which holds a *different*
   * slice — the day it is showing, not today — and would otherwise stay on the
   * value it read before the overlay opened.
   */
  const closeFocus = useCallback((entry: RegistryEntry): void => {
    setFocused(null)
    setSnapshot(previous => (previous === null ? previous : withEntry(previous, entry)))
    void refresh()
    setBoardToken(token => token + 1)
  }, [refresh])

  /**
   * Take the registry lists from a slice the board read.
   *
   * `tasks` and `media` are registry-wide — a task or a film belongs to no habit
   * day — so the board's read of whatever day it is showing carries the same
   * lists the column needs. That is how a card pinned in the column notices a
   * task completed on the board, instead of waiting for the window to lose and
   * regain focus.
   */
  const mergeRegistry = useCallback((next: StateView): void => {
    setSnapshot(previous => (
      previous === null ? previous : { ...previous, tasks: next.tasks, media: next.media }
    ))
  }, [])

  // A pinned item the registry no longer holds (deleted elsewhere) is dropped
  // rather than drawn as a card with nothing behind it — and so is one whose
  // task is finished: a done task has nothing left for a "最近专注" card, and the
  // only way out of the column used to be the user pressing ×.
  useEffect(() => {
    if (pinned === null || snapshot === null) return
    // Not while its own overlay is open: the user may be about to clear that
    // "done" right there (标记未完成), and the pin would then be gone for good.
    if (focused !== null && focused.kind === pinned.kind && focused.id === pinned.id) return
    const entry = entryFor(pinned)
    if (entry !== undefined && !pinShouldRetire(entry)) return
    setPinned(null)
    writePinned(storage.current, null)
  }, [entryFor, focused, pinned, snapshot])

  const pinnedEntry = entryFor(pinned)
  const focusedEntry = entryFor(focused)
  const overdue = snapshot === null ? 0 : snapshot.tasks.filter(task => task.overdue).length
  const remaining = snapshot === null ? 0 : snapshot.tasks.filter(task => task.state !== 'done').length

  return (
    <div className="pt-track">
      <header className="pt-track-head">
        <h2>习惯看板</h2>
        <Pills value={view} options={VIEWS} onChange={setView} />
      </header>

      {error === null ? null : <div className="pt-error">{error}</div>}

      {view === 'board' ? (
        <div className="pt-track-body">
          <FocusColumn
            entry={pinnedEntry}
            today={clock?.today ?? ''}
            night={clock?.nightTail ?? false}
            progress={snapshot?.day.progress}
            remaining={remaining}
            overdue={overdue}
            onUnpin={unpin}
            onContinue={() => { if (pinnedEntry !== undefined) setFocused(pinnedOf(pinnedEntry)) }}
          />
          <BoardBody
            client={client}
            onShowStats={() => setView('stats')}
            onOpenFocus={openFocus}
            refreshToken={boardToken}
            onStateRead={mergeRegistry}
          />
        </div>
      ) : (
        <StatsPanel client={client} />
      )}

      {focused !== null && focusedEntry !== undefined ? (
        <FocusOverlay
          client={client}
          target={focused}
          entry={focusedEntry}
          onClose={closeFocus}
        />
      ) : null}
    </div>
  )
}
