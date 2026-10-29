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

/** Render the column. */
export function FocusColumn({
  recent, today, night, progress, remaining, overdue, onContinue,
}: FocusColumnProps): JSX.Element {
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
    const sub = 'state' in entry
      ? `${entry.progress.total === undefined
        ? (entry.progress.current > 0 ? '已完成' : '未完成')
        : `进度 ${fractionText(entry.progress.current)}/${fractionText(entry.progress.total)}`}${
        entry.due === undefined ? '' : ` · 截止于${entry.due === today ? '今天' : entry.due.slice(5)}`}`
      : `${entry.kind === 'film' ? '影' : '书'} · ${mediaStatusLabel(entry.status)}`
    const classes = 'state' in entry && entry.overdue
      ? 'pt-focus-card pt-focus-card-late'
      : 'pt-focus-card'
    return (
      <aside className="pt-focus-col">
        <span className="pt-focus-label">专注栏 · 最近专注</span>
        <div className={classes}>
          <div className="pt-focus-card-head">
            <span className="pt-focus-title">{entry.title}</span>
          </div>
          <span className="pt-focus-sub">{sub}</span>
          <span className="pt-focus-sub">
            最近一段 {sessionStamp(session.startedAt)} · {formatDuration(focusSeconds([session]))}
          </span>
          <span className="pt-focus-time">累计专注 {formatDuration(entry.focusSeconds)}</span>
          <div className="pt-focus-actions">
            <button type="button" className="pt-primary" onClick={onContinue}>继续专注</button>
          </div>
        </div>
      </aside>
    )
  }

  const ratio = progress === undefined || progress.total === 0 ? 0 : progress.done / progress.total
  const [year, month, day] = today.split('-')
  return (
    <aside className="pt-focus-col">
      <span className="pt-focus-label">专注栏</span>
      <div className="pt-focus-clock">{nowLabel(now)}</div>
      <div className="pt-focus-date">
        {`习惯日 ${year ?? ''}-${month ?? ''}-${day ?? ''}`}
        {night ? <span className="pt-night-badge">夜</span> : null}
      </div>
      <ProgressRing
        ratio={ratio}
        label={`${fractionText(progress?.done ?? 0)}/${fractionText(progress?.total ?? 0)}`}
        sub="今日"
      />
      <span className="pt-focus-todo">
        剩余任务 <b>{remaining}</b> · 逾期 <b>{overdue}</b>
      </span>
    </aside>
  )
}
