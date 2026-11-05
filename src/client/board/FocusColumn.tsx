/**
 * The focus column: what the board view keeps on its left.
 *
 * With a session behind it the column is that entry's card — the way back into
 * focus mode, with the **最近一段专注会话**'s own start and length beside its
 * running total. There is no dismiss button, because the card is not a
 * notification: it reports the last closed session, which is a fact, and the
 * honest way to change it is to focus on something else.
 *
 * Without one it is the reason the column is worth keeping at all: a clock, the
 * habit day it belongs to, today's completion and what is still open. Both
 * states are read from data the panel already has, so an idle column costs no
 * request.
 */
import { useEffect, useState, type JSX } from 'react'
import { focusSeconds, type Session } from '../../shared/focus-session.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import type { RegistryEntry } from './focus.ts'
import { formatDuration, nowLabel, sessionStamp } from './focus.ts'
import { fractionText, mediaStatusLabel } from './format.ts'
import { ProgressRing } from './tile.tsx'

/** Props for the column. */
export interface FocusColumnProps {
  /** The entry whose session started last, and that session. */
  readonly recent: { readonly entry: RegistryEntry; readonly session: Session } | undefined
  /** The current habit day, for the empty state's date line. */
  readonly today: string
  /** True inside the night tail, when the day shown is the previous one. */
  readonly night: boolean
  /** Today's completion, or undefined before the first read lands. */
  readonly progress: { readonly done: number; readonly total: number } | undefined
  /** Unfinished tasks, and how many of them are overdue. */
  readonly remaining: number
  readonly overdue: number
  readonly onContinue: () => void
}

/** The one-line state under a recent entry's title. */
function stateLine(entry: RegistryEntry, today: string, copy: Copy): string {
  if (!('state' in entry)) {
    return `${copy(entry.kind === 'film' ? 'focus.kind.film' : 'focus.kind.book')} · ${mediaStatusLabel(entry.status, copy)}`
  }
  const progress = entry.progress.total === undefined
    ? copy(entry.progress.current > 0 ? 'chip.done' : 'chip.missing')
    : copy('focus.progress', {
      current: fractionText(entry.progress.current),
      total: fractionText(entry.progress.total),
    })
  if (entry.due === undefined) return progress
  const due = entry.due === today ? copy('focus.due.today') : copy('focus.due', { date: entry.due.slice(5) })
  return `${progress} · ${due}`
}

/** Render the column. */
export function FocusColumn({
  recent, today, night, progress, remaining, overdue, onContinue,
}: FocusColumnProps): JSX.Element {
  const t = useCopy()
  const [now, setNow] = useState(() => new Date())

  // Only the empty state needs a moving clock, but the interval is cheap and
  // keeping it unconditional avoids a hook that appears and disappears with the
  // recent session.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  if (recent !== undefined) {
    const { entry, session } = recent
    const sub = stateLine(entry, today, t)
    const classes = 'state' in entry && entry.overdue
      ? 'pt-focus-card pt-focus-card-late'
      : 'pt-focus-card'
    return (
      <aside className="pt-focus-col">
        <span className="pt-focus-label">{t('focus.recent')}</span>
        <div className={classes}>
          <div className="pt-focus-card-head">
            <span className="pt-focus-title">{entry.title}</span>
          </div>
          <span className="pt-focus-sub">{sub}</span>
          <span className="pt-focus-sub">
            {t('focus.last', {
              stamp: sessionStamp(session.startedAt),
              duration: formatDuration(focusSeconds([session])),
            })}
          </span>
          <span className="pt-focus-time">{t('focus.total', { duration: formatDuration(entry.focusSeconds) })}</span>
          <div className="pt-focus-actions">
            <button type="button" className="pt-primary" onClick={onContinue}>{t('focus.continue')}</button>
          </div>
        </div>
      </aside>
    )
  }

  const ratio = progress === undefined || progress.total === 0 ? 0 : progress.done / progress.total
  return (
    <aside className="pt-focus-col">
      <span className="pt-focus-label">{t('focus.column')}</span>
      <div className="pt-focus-clock">{nowLabel(now, t)}</div>
      <div className="pt-focus-date">
        {t('habitDay', { date: today })}
        {night ? <span className="pt-night-badge">{t('focus.night')}</span> : null}
      </div>
      <ProgressRing
        ratio={ratio}
        label={`${fractionText(progress?.done ?? 0)}/${fractionText(progress?.total ?? 0)}`}
        sub={t('date.today')}
      />
      <span className="pt-focus-todo">
        {t('focus.openTasks')} <b>{remaining}</b> · {t('focus.overdueTasks')} <b>{overdue}</b>
      </span>
    </aside>
  )
}
