/**
 * The board's date navigator: previous/next habit day, a jump-to-date control
 * for backfill, and the way back to the current habit day.
 *
 * It cannot reach the future — the host decides what "today" is, and a future
 * habit day has nothing to record.
 */
import { useState, type JSX } from 'react'
import { shiftDayKey } from '../../shared/habit-day.ts'
import { useCopy } from '../copy/index.tsx'
import { dayLabelOf } from './format.ts'

/** Props for the navigator. */
export interface DateNavProps {
  readonly date: string
  readonly today: string
  /** True while the host sits in the night tail (00:00–boundary). */
  readonly night: boolean
  readonly onChange: (date: string) => void
}

/** Render the navigator. */
export function DateNav({ date, today, night, onChange }: DateNavProps): JSX.Element {
  const t = useCopy()
  const [jump, setJump] = useState('')
  const atToday = date >= today
  const isNight = night && date === today

  return (
    <div className="pt-nav-wrap">
      <div className="pt-nav">
        <button
          type="button"
          className="pt-icon"
          title={t('date.previous')}
          aria-label={t('date.previous')}
          onClick={() => onChange(shiftDayKey(date, -1))}
        >‹</button>
        <div className="pt-nav-label">
          {dayLabelOf(date, isNight, t)}
          {isNight ? <small className="pt-muted"> · {t('date.nightTag')}</small> : null}
        </div>
        <button
          type="button"
          className="pt-icon"
          title={t('date.next')}
          aria-label={t('date.next')}
          disabled={atToday}
          onClick={() => onChange(shiftDayKey(date, 1))}
        >›</button>
        <button
          type="button"
          className="pt-ghost"
          disabled={atToday}
          title={t('date.back')}
          onClick={() => onChange(today)}
        >{t('date.todayButton')}</button>
      </div>
      <div className="pt-nav-second">
        <input
          className="pt-input pt-date"
          type="date"
          value={jump === '' ? date : jump}
          max={today}
          onChange={(event) => {
            setJump(event.target.value)
            if (event.target.value !== '') onChange(event.target.value)
          }}
          title={t('date.jump')}
        />
        <span className="pt-muted">{date === today ? t('date.current') : t('date.backfilling')}</span>
      </div>
    </div>
  )
}
