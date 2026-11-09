/**
 * The plugin's one surface: 打卡 and 统计, with the focus column on the left of
 * the board view.
 *
 * The panel owns what both views and the focus surfaces need — the registry
 * snapshot, the clock, and which entry focus mode is open on — while the board
 * keeps owning its own shown day. Focus mode itself is an overlay rendered from
 * here, over whichever view is up.
 *
 * The column's two lists are both **derived or direct, never remembered**: the
 * todos are records the host stores, and the "focused on" rows are read off the
 * closed sessions every entry already carries — so the column is the same in
 * every tab and survives a reload without any browser-local state.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { HabitClient } from '../api.ts'
import { CopyProvider, useCopy } from '../copy/index.tsx'
import type { CopyKey } from '../copy/table.ts'
import type { LocaleService } from '../locale.ts'
import type { ClockView, StateView, TodoEntry } from '../types.ts'
import { BoardBody } from './BoardBody.tsx'
import { FocusColumn } from './FocusColumn.tsx'
import { FocusOverlay } from './FocusOverlay.tsx'
import {
  focusedListOf,
  kindOf,
  targetOf,
  withEntry,
  type FocusTarget,
  type RegistryEntry,
} from './focus.ts'
import { messageOf } from './format.ts'
import { StatsPanel } from './stats-panel.tsx'
import { Pills } from './tile.tsx'

/** The two views inside the panel. */
type ViewKey = 'board' | 'stats'

const VIEWS: readonly { readonly value: ViewKey; readonly label: CopyKey }[] = [
  { value: 'board', label: 'panel.view.board' },
  { value: 'stats', label: 'panel.view.stats' },
]

/** Props handed in by the slot registration's injection face. */
export interface TrackPanelProps {
  readonly client: HabitClient
  readonly locale: LocaleService
}

/** The panel's root: it owns the language subscription for everything below. */
export function TrackPanel({ client, locale }: TrackPanelProps): JSX.Element {
  return <CopyProvider locale={locale}><Panel client={client} /></CopyProvider>
}

/** Render the panel. */
function Panel({ client }: { readonly client: HabitClient }): JSX.Element {
  const t = useCopy()
  const [view, setView] = useState<ViewKey>('board')
  const [snapshot, setSnapshot] = useState<StateView | null>(null)
  const [clock, setClock] = useState<ClockView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState<FocusTarget | null>(null)
  /** True while a todo write is in flight; the column's box and input rest. */
  const [todoBusy, setTodoBusy] = useState(false)
  /**
   * Whether the phone's folded column is open.
   *
   * It says nothing above 720px, where the column is always open and this row is
   * `display:none` — no width is ever read in JavaScript, so a resize needs no
   * listener and the fold cannot disagree with the layout it is folded into.
   */
  const [todosOpen, setTodosOpen] = useState(false)
  /** Bumped when focus mode closes, so the board re-reads the day it shows. */
  const [boardToken, setBoardToken] = useState(0)
  /** Reads issued so far, so an older answer cannot overwrite a newer one. */
  const reads = useRef(0)
  /** Todo writes in flight, so a fast second tick cannot clear the first's flag. */
  const pendingWrites = useRef(0)

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
      if (seq === reads.current) setError(messageOf(cause, t))
    }
  }, [client, t])

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
    () => (snapshot === null
      ? []
      // Spread with a fallback per list: a host half from before the todos
      // existed answers without it, and `[...undefined]` throws mid-render.
      // `api.state` already names that host; this keeps the frame that is
      // already drawn from dying while the message arrives.
      : [
          ...(snapshot.tasks ?? []),
          ...(snapshot.media ?? []),
          ...(snapshot.todos ?? []),
        ]),
    [snapshot],
  )

  /** The column's derived half — see `focusedListOf` for why never a todo. */
  const focusedEntries = useMemo(() => focusedListOf(entries), [entries])

  const entryFor = useCallback(
    (target: FocusTarget | null): RegistryEntry | undefined =>
      target === null ? undefined : entries.find(entry => kindOf(entry) === target.kind && entry.id === target.id),
    [entries],
  )

  /** Enter focus mode on one entry. Nothing is remembered but the target. */
  const openFocus = useCallback((entry: RegistryEntry): void => {
    setFocused(targetOf(entry))
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
   * lists the column needs. That is how the column notices a task completed on
   * the board, instead of waiting for the window to lose and regain focus.
   */
  const mergeRegistry = useCallback((next: StateView): void => {
    setSnapshot(previous => (
      previous === null
        ? previous
        : { ...previous, tasks: next.tasks, media: next.media, todos: next.todos }
    ))
  }, [])

  /**
   * One todo write, adopting the slice it answers with.
   *
   * The column is not the board: it has no day of its own to re-read, and its
   * answer is already the full slice — so the snapshot is replaced outright and a
   * failure lands on the panel's error line instead of vanishing.
   */
  const writeTodo = useCallback(async (action: () => Promise<StateView>): Promise<void> => {
    pendingWrites.current += 1
    setTodoBusy(true)
    try {
      const next = await action()
      // This answer is newer than any read still in flight, so it retires them —
      // the same line `BoardBody.act` draws, and for the same reason: without it
      // a `refresh()` issued before the write lands afterwards and puts the row
      // back the way it was, so a tick visibly reverts.
      reads.current += 1
      setSnapshot(next)
      setError(null)
    } catch (cause) {
      setError(messageOf(cause, t))
    } finally {
      pendingWrites.current -= 1
      if (pendingWrites.current === 0) setTodoBusy(false)
    }
  }, [t])

  const focusedEntry = entryFor(focused)
  const overdue = snapshot === null ? 0 : snapshot.tasks.filter(task => task.overdue).length
  const remaining = snapshot === null ? 0 : snapshot.tasks.filter(task => task.state !== 'done').length
  const openTodos = snapshot === null ? 0 : (snapshot.todos ?? []).filter(todo => !todo.done).length
  const views = useMemo(() => VIEWS.map(({ value, label }) => ({ value, label: t(label) })), [t])

  return (
    <div className="pt-track">
      <header className="pt-track-head">
        <h2>{t('panel.title')}</h2>
        <Pills value={view} options={views} onChange={setView} />
      </header>

      {error === null ? null : <div className="pt-error">{error}</div>}

      {view === 'board' ? (
        <div className="pt-track-body">
          {/* The fold row and the column are one slot of the row: on a phone the
              row stands in for the column, and open they sit stacked. */}
          <div className={todosOpen ? 'pt-todo-col pt-todo-col-open' : 'pt-todo-col'}>
            <button
              type="button"
              className="pt-todo-toggle"
              aria-expanded={todosOpen}
              onClick={() => setTodosOpen(open => !open)}
            >
              <span className="pt-todo-toggle-label">{t('todo.title')}</span>
              <span className="pt-todo-toggle-count">{t('todo.openCount', { count: openTodos })}</span>
              <span className="pt-todo-toggle-chev" aria-hidden="true">{todosOpen ? '▴' : '▾'}</span>
            </button>
            <FocusColumn
              todos={snapshot?.todos ?? []}
              focused={focusedEntries}
              today={clock?.today ?? ''}
              night={clock?.nightTail ?? false}
              progress={snapshot?.day.progress}
              remaining={remaining}
              overdue={overdue}
              busy={todoBusy}
              onAdd={title => void writeTodo(() => client.addTodo({ title }))}
              onToggle={todo => void writeTodo(() => client.patchTodo(todo.id, { done: !todo.done }))}
              onRemove={todo => void writeTodo(() => client.removeTodo(todo.id))}
              onFocusTodo={todo => setFocused({ kind: 'todo', id: todo.id })}
              onFocusEntry={entry => setFocused(targetOf(entry))}
            />
          </div>
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
          today={clock?.today ?? ''}
          onClose={closeFocus}
        />
      ) : null}
    </div>
  )
}
