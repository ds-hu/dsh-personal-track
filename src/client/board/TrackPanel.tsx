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
  readPinned,
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
  const storage = useRef<PinStorage>(pinStorage())

  /** Re-read everything the column and the overlay are built from. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextClock, nextState] = await Promise.all([client.clock(), client.state()])
      setClock(nextClock)
      setSnapshot(nextState)
      setError(null)
    } catch (cause) {
      setError(messageOf(cause))
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

  // A pinned item the registry no longer holds (deleted elsewhere) is dropped
  // rather than drawn as a card with nothing behind it.
  useEffect(() => {
    if (pinned === null || snapshot === null) return
    if (entryFor(pinned) !== undefined) return
    setPinned(null)
    writePinned(storage.current, null)
  }, [entryFor, pinned, snapshot])

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
          onClose={() => {
            setFocused(null)
            void refresh()
          }}
        />
      ) : null}
    </div>
  )
}
