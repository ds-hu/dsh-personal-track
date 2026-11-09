/**
 * The focus column: the todo list the board view keeps on its left.
 *
 * It began as "the latest focus session" and a clock — a card you could not act
 * on. What it is now is the column's actual job: a list you can write into, tick
 * off, and start a session from. Three things share the space, in the order they
 * are read:
 *
 * - the clock, its habit day, and the day's completion, on one line — the column
 *   belongs to the board beside it, not the other way round;
 * - your todos: one line each, a box, a title, and the time you have spent on it;
 * - everything you have *focused on*, which is a derived list: a task or a title
 *   with focus time appears here without being copied into a todo, so it can
 *   never disagree with the entry it came from.
 *
 * A todo's box is the todo's own fact: ticking it moves no task's bar, and
 * finishing a task ticks nothing off here. That is the whole reason it is not a
 * task with a smaller form.
 */
import { useEffect, useState, type JSX } from 'react'
import { useCopy } from '../copy/index.tsx'
import type { TodoEntry } from '../types.ts'
import type { RegistryEntry } from './focus.ts'
import { clockLabel, formatDuration } from './focus.ts'
import { fractionText } from './format.ts'

/** Props for the column. */
export interface FocusColumnProps {
  /** The left column's own list, newest first as the host answers it. */
  readonly todos: readonly TodoEntry[]
  /** Entries that already carry focus time — derived, never copied. */
  readonly focused: readonly RegistryEntry[]
  /** The current habit day, for the date line. */
  readonly today: string
  /** True inside the night tail, when the day shown is the previous one. */
  readonly night: boolean
  /** Today's completion, or undefined before the first read lands. */
  readonly progress: { readonly done: number; readonly total: number } | undefined
  /** Unfinished tasks, and how many of them are overdue. */
  readonly remaining: number
  readonly overdue: number
  /** A write is in flight: the boxes and the input rest until it lands. */
  readonly busy: boolean
  readonly onAdd: (title: string) => void
  readonly onToggle: (todo: TodoEntry) => void
  readonly onRemove: (todo: TodoEntry) => void
  readonly onFocusTodo: (todo: TodoEntry) => void
  readonly onFocusEntry: (entry: RegistryEntry) => void
}

/** One todo line: a box, its title, and the time spent on it. */
function TodoRow({ todo, busy, onToggle, onRemove, onFocus }: {
  readonly todo: TodoEntry
  readonly busy: boolean
  readonly onToggle: () => void
  readonly onRemove: () => void
  readonly onFocus: () => void
}): JSX.Element {
  const t = useCopy()
  return (
    <div className="pt-todo-row">
      <button
        type="button"
        className={todo.done ? 'pt-todo-box pt-todo-box-on' : 'pt-todo-box'}
        title={todo.done ? t('todo.markUndone') : t('todo.markDone')}
        disabled={busy}
        onClick={onToggle}
      >{todo.done ? '✓' : ''}</button>
      <button
        type="button"
        className={todo.done ? 'pt-todo-title pt-todo-title-done' : 'pt-todo-title'}
        title={t('tile.focus')}
        onClick={onFocus}
      >{todo.title}</button>
      {todo.focusSeconds <= 0
        ? null
        : <span className="pt-todo-meta">{t('todo.focus', { duration: formatDuration(todo.focusSeconds) })}</span>}
      <button
        type="button"
        className="pt-todo-drop"
        title={t('todo.remove')}
        disabled={busy}
        onClick={onRemove}
      >×</button>
    </div>
  )
}

/** One derived line: an entry that has been focused on. */
function FocusedRow({ entry, onFocus }: {
  readonly entry: RegistryEntry
  readonly onFocus: () => void
}): JSX.Element {
  const t = useCopy()
  return (
    <div className="pt-todo-row">
      <span className="pt-todo-mark">⤢</span>
      <button
        type="button"
        className="pt-todo-title"
        title={t('tile.focus')}
        onClick={onFocus}
      >{entry.title}</button>
      <span className="pt-todo-meta">{t('todo.focus', { duration: formatDuration(entry.focusSeconds) })}</span>
    </div>
  )
}

/** Render the column. */
export function FocusColumn({
  todos, focused, today, night, progress, remaining, overdue, busy,
  onAdd, onToggle, onRemove, onFocusTodo, onFocusEntry,
}: FocusColumnProps): JSX.Element {
  const t = useCopy()
  const [now, setNow] = useState(() => new Date())
  const [draft, setDraft] = useState('')

  // The clock is the only thing here that moves on its own.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const submit = (): void => {
    const title = draft.trim()
    if (title === '') return
    setDraft('')
    onAdd(title)
  }

  return (
    <aside className="pt-focus-col">
      <div className="pt-focus-date">
        <span className="pt-clock-inline">{clockLabel(now)}</span>
        <span className="pt-muted">·</span>
        {t('habitDay', { date: today })}
        {night ? <span className="pt-night-badge">{t('focus.night')}</span> : null}
      </div>

      <span className="pt-focus-todo">
        {t('focus.progress', {
          current: fractionText(progress?.done ?? 0),
          total: fractionText(progress?.total ?? 0),
        })}
        {' · '}
        {t('focus.openTasks')} <b>{remaining}</b>
        {' · '}
        {t('focus.overdueTasks')} <b>{overdue}</b>
      </span>

      <form
        className="pt-todo-add"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <input
          className="pt-todo-input"
          value={draft}
          placeholder={t('todo.addHint')}
          disabled={busy}
          onChange={event => setDraft(event.target.value)}
        />
        <button type="submit" className="pt-icon" title={t('todo.add')}>＋</button>
      </form>

      <div className="pt-todo-sec">{t('todo.title')}</div>
      {todos.length === 0
        ? <span className="pt-muted">{t('todo.empty')}</span>
        : todos.map(todo => (
          <TodoRow
            key={todo.id}
            todo={todo}
            busy={busy}
            onToggle={() => onToggle(todo)}
            onRemove={() => onRemove(todo)}
            onFocus={() => onFocusTodo(todo)}
          />
        ))}

      {focused.length === 0 ? null : (
        <>
          <div className="pt-todo-sec">{t('todo.focused')}</div>
          {focused.map(entry => (
            <FocusedRow key={`${entry.id}`} entry={entry} onFocus={() => onFocusEntry(entry)} />
          ))}
        </>
      )}
    </aside>
  )
}
