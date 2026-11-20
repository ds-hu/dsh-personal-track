/**
 * The time view: one habit day, drawn as three rows of a single rail.
 *
 * The host derives every row (`src/host/time.ts`); this component only places
 * intervals and prints their totals. The two totals that are easy to get wrong
 * are computed here with the same shared arithmetic the host uses:
 *
 * - the overview is a **union** (`splitBySource`), so overlapping focus,
 *   conversation and record time takes one width and the sub-bands say which
 *   sources were there;
 * - a row's own total is a **sum** of its intervals, which is why the group
 *   header can differ from the overview's union.
 *
 * `详情` shows every row; `全天总览` shows the three merged rows and is the
 * default because the day's shape is the question. The conversation group has
 * one row per conversation plus a `patrol` row for the time between
 * conversations; the client joins the conversation titles from the session
 * list, because the host speaks ids and not language.
 */
import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { shiftDayKey } from '../../shared/habit-day.ts'
import { mergeSpans, spanOf, splitBySource, type TimeSpan } from '../../shared/time-union.ts'
import type { HabitClient } from '../api.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import type { CopyKey } from '../copy/table.ts'
import type { ClockView, TimeInterval, TimeRow, TimeView } from '../types.ts'
import { messageOf, monthDayOf, weekdayOf } from './format.ts'

/** Props for the time view. */
export interface TimePanelProps {
  readonly client: HabitClient
  /** Session id → title, joined in the panel (the host speaks ids). */
  readonly sessionTitles?: Readonly<Record<string, string>>
}

/** How the rows are shown. */
type Mode = 'overview' | 'detail'

/** The copy keys of the habits a record row can name. */
const RECORD_KEYS: Record<string, CopyKey> = {
  wash: 'habit.wash',
  shower: 'habit.shower',
  meals: 'meal.total',
  vocab: 'habit.vocab',
  duolingo: 'habit.duolingo',
  run: 'stats.card.run',
  rope: 'stats.card.rope',
  free: 'stats.card.free',
  pullup: 'stats.card.pullup',
  plank: 'stats.card.plank',
}

/** The record row's name; an unknown id falls back to itself, never to prose. */
function recordLabel(id: string, t: Copy): string {
  const key = RECORD_KEYS[id]
  return key === undefined ? id : t(key)
}

/** `HH:mm` in the host's zone; the browser's own when the host named none. */
function clockIn(iso: string, timezone: string | undefined): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    ...(timezone === undefined ? {} : { timeZone: timezone }),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? ''
  return `${pick('hour')}:${pick('minute')}`
}

/** `2:05` past an hour, `45 分` below it; `0 分` for nothing. */
function durationOf(seconds: number, t: Copy): string {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('unit.minutes', { minutes })
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}

/** Percentage of an instant across the day's rail. */
function percentOf(instant: string, fromMs: number, toMs: number): number {
  return ((Date.parse(instant) - fromMs) / (toMs - fromMs)) * 100
}

/** A block's box, clipped to the day; null when it falls outside. */
function boxOf(interval: TimeInterval, fromMs: number, toMs: number): { left: string; width: string } | null {
  const start = Math.max(Date.parse(interval.startedAt), fromMs)
  const end = Math.min(Date.parse(interval.endedAt), toMs)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return {
    left: `${((start - fromMs) / (toMs - fromMs)) * 100}%`,
    width: `${((end - start) / (toMs - fromMs)) * 100}%`,
  }
}

/** The union of a group's rows as spans. */
function spansOf(rows: readonly TimeRow[]): TimeSpan[] {
  return mergeSpans(rows.flatMap(row => row.intervals.map(spanOf).filter((span): span is TimeSpan => span !== undefined)))
}

/** The tooltip of one block. */
function blockTitle(
  row: TimeRow,
  interval: TimeInterval,
  t: Copy,
  timezone: string | undefined,
  group: 'focus' | 'talk' | 'record',
): string {
  const params = {
    start: clockIn(interval.startedAt, timezone),
    end: clockIn(interval.endedAt, timezone),
    duration: durationOf((Date.parse(interval.endedAt) - Date.parse(interval.startedAt)) / 1000, t),
  }
  if (group === 'record') return t('time.block.record', { ...params, title: recordLabel(row.id, t) })
  if (group === 'focus') return t('time.block.focus', { ...params, title: row.title ?? row.id })
  return t('time.block.talk', params)
}

/** One conversation row's label: the session title, or the patrol's own name. */
function talkLabel(row: TimeRow, titles: Readonly<Record<string, string>> | undefined, t: Copy): string {
  if (row.id === 'patrol') return t('time.patrol')
  return titles?.[row.id] ?? row.title ?? t('time.talk')
}

/** One day's time view. */
export function TimePanel({ client, sessionTitles }: TimePanelProps): JSX.Element {
  const t = useCopy()
  const [clock, setClock] = useState<ClockView | null>(null)
  const [view, setView] = useState<TimeView | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('overview')
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const reads = useRef(0)

  // The panel reads on mount, on a date change and on window focus — never on a
  // timer. The connection pool charges every read, so the view follows the same
  // contract as the board instead of polling for a minute's freshness.
  useEffect(() => {
    const onFocus = (): void => setRefresh(value => value + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const next = await client.clock()
        if (!live) return
        setClock(next)
        setDate(current => current ?? next.today)
      } catch (cause) {
        if (live) setError(messageOf(cause, t))
      }
    })()
    return () => { live = false }
  }, [client, refresh, t])

  useEffect(() => {
    if (date === null) return
    const seq = reads.current + 1
    reads.current = seq
    let live = true
    void (async () => {
      try {
        const next = await client.time(date)
        if (!live || reads.current !== seq) return
        setView(next)
        setError(null)
      } catch (cause) {
        if (live && reads.current === seq) setError(messageOf(cause, t))
      }
    })()
    return () => { live = false }
  }, [client, date, refresh, t])

  /** Move to another habit day; the old chart must not stand under a new date. */
  const go = (next: string): void => {
    setView(null)
    setDate(next)
  }

  if (clock === null || date === null) {
    return (
      <div className="pt-time">
        {error === null ? null : <div className="pt-error">{error}</div>}
        <span className="pt-muted">{t('board.loading')}</span>
      </div>
    )
  }

  const atToday = date >= clock.today
  const rangeFrom = view?.ticks[0]?.label ?? `${String(clock.config.dayStartHour).padStart(2, '0')}:00`
  const rangeTo = view?.ticks[view.ticks.length - 1]?.label ?? rangeFrom
  const timezone = view?.timezone
  const fromMs = view === null ? 0 : Date.parse(view.from)
  const toMs = view === null ? 0 : Date.parse(view.to)
  const nowMs = Date.parse(clock.now)
  const showNow = view !== null && date === clock.today && nowMs >= fromMs && nowMs <= toMs
  const nightPct = view === null ? 83.3333 : percentOf(view.nightFrom, fromMs, toMs)
  const nowPct = showNow ? percentOf(clock.now, fromMs, toMs) : 0
  const vars = {
    '--pt-time-night': `${nightPct}%`,
    '--pt-time-now': `${nowPct}%`,
  } as CSSProperties

  const focusSeconds = view?.totals.focus ?? 0
  const talkSeconds = view?.totals.talk ?? 0
  const trackedSeconds = view?.totals.covered ?? 0
  const card = view === null ? null : (
    <>
      {mode === 'overview'
        ? <Overview view={view} showNow={showNow} timezone={timezone} />
        : <Detail view={view} showNow={showNow} timezone={timezone} sessionTitles={sessionTitles} />}
    </>
  )

  return (
    <div className="pt-time">
      {error === null ? null : <div className="pt-error">{error}</div>}
      <div className="pt-time-card" style={vars}>
        <header className="pt-time-head">
          <div className="pt-time-nav">
            <button
              type="button"
              className="pt-icon"
              title={t('date.previous')}
              aria-label={t('date.previous')}
              onClick={() => go(shiftDayKey(date, -1))}
            >‹</button>
            <span className="pt-time-date">{monthDayOf(date, t)} {weekdayOf(date, t)}</span>
            <button
              type="button"
              className="pt-icon"
              title={t('date.next')}
              aria-label={t('date.next')}
              disabled={atToday}
              onClick={() => go(shiftDayKey(date, 1))}
            >›</button>
            <button
              type="button"
              className="pt-ghost pt-time-today"
              disabled={date === clock.today}
              onClick={() => go(clock.today)}
            >{t('date.todayButton')}</button>
          </div>
          <div className="pt-time-sub">
            <span>{t('time.range', { from: rangeFrom, to: rangeTo })}</span>
            {showNow ? <span className="pt-time-now">{t('time.now', { time: clockIn(clock.now, timezone) })}</span> : null}
          </div>
          <div className="pt-time-stats">
            <Stat value={durationOf(focusSeconds, t)} label={t('time.focus')} kind="focus" />
            <Stat value={durationOf(talkSeconds, t)} label={t('time.talk')} kind="talk" />
            <Stat value={durationOf(trackedSeconds, t)} label={t('time.tracked')} kind="tracked" />
          </div>
          <div className="pt-time-seg" role="group">
            <button
              type="button"
              className={mode === 'detail' ? 'pt-time-seg-on' : undefined}
              onClick={() => setMode('detail')}
            >{t('time.detail')}</button>
            <button
              type="button"
              className={mode === 'overview' ? 'pt-time-seg-on' : undefined}
              onClick={() => setMode('overview')}
            >{t('time.overview')}</button>
          </div>
        </header>
        {card ?? <span className="pt-muted">{t('board.loading')}</span>}
      </div>
    </div>
  )
}

/** One stat under the date line. */
function Stat({ value, label, kind }: { readonly value: string; readonly label: string; readonly kind: string }): JSX.Element {
  return (
    <div className={`pt-time-stat pt-time-stat-${kind}`}>
      <span className="pt-time-stat-value">{value}</span>
      <span className="pt-time-stat-label">{label}</span>
    </div>
  )
}

/** The merged three rows: the day's shape. */
function Overview({ view, showNow, timezone }: { readonly view: TimeView; readonly showNow: boolean; readonly timezone: string | undefined }): JSX.Element {
  const t = useCopy()
  const fromMs = Date.parse(view.from)
  const toMs = Date.parse(view.to)
  const focusSpans = spansOf(view.focus)
  const talkSpans = spansOf(view.talk)
  const recordSpans = spansOf(view.records)
  const merged = splitBySource([
    { source: 'focus', spans: focusSpans },
    { source: 'talk', spans: talkSpans },
    { source: 'record', spans: recordSpans },
  ])
  const sourceLabel = (source: string): string =>
    source === 'focus' ? t('time.focus') : source === 'talk' ? t('time.talk') : t('time.records')

  const row = (key: 'focus' | 'talk' | 'overview'): JSX.Element => {
    const label = key === 'focus' ? t('time.focus') : key === 'talk' ? t('time.talk') : t('time.overview')
    const total = key === 'focus' ? view.totals.focus : key === 'talk' ? view.totals.talk : view.totals.covered
    const spans = key === 'focus' ? focusSpans : key === 'talk' ? talkSpans : []
    return (
      <div className={`pt-time-ov-row pt-time-ov-row-${key}`} key={key}>
        <span className={`pt-time-key pt-time-key-${key}`}>{label}</span>
        <span className="pt-time-ov-track">
          {key === 'overview'
            ? merged.map(segment => (
              <span
                className="pt-time-ov-seg"
                key={`${segment.start}-${segment.sources.join('-')}`}
                style={{ left: `${((segment.start - fromMs) / (toMs - fromMs)) * 100}%`, width: `${((segment.end - segment.start) / (toMs - fromMs)) * 100}%` }}
                title={t('time.block.merged', {
                  sources: segment.sources.map(sourceLabel).join(' + '),
                  start: clockIn(new Date(segment.start).toISOString(), timezone),
                  end: clockIn(new Date(segment.end).toISOString(), timezone),
                  duration: durationOf((segment.end - segment.start) / 1000, t),
                })}
              >
                {segment.sources.map(source => <i className={`pt-time-band pt-time-band-${source}`} key={source} />)}
              </span>
            ))
            : spans.map(span => (
              <span
                className={`pt-time-ov-blk pt-time-ov-blk-${key}`}
                key={span.start}
                style={{ left: `${((span.start - fromMs) / (toMs - fromMs)) * 100}%`, width: `${((span.end - span.start) / (toMs - fromMs)) * 100}%` }}
                title={key === 'focus'
                  ? t('time.block.focus', {
                    title: t('time.focus'),
                    start: clockIn(new Date(span.start).toISOString(), timezone),
                    end: clockIn(new Date(span.end).toISOString(), timezone),
                    duration: durationOf((span.end - span.start) / 1000, t),
                  })
                  : t('time.block.talk', {
                    start: clockIn(new Date(span.start).toISOString(), timezone),
                    end: clockIn(new Date(span.end).toISOString(), timezone),
                    duration: durationOf((span.end - span.start) / 1000, t),
                  })}
              />
            ))}
          {showNow ? <i className="pt-time-now-line" /> : null}
        </span>
        <span className="pt-time-ov-total">{durationOf(total, t)}</span>
      </div>
    )
  }

  return (
    <div className="pt-time-ov">
      <div className="pt-time-ov-axis">
        <span />
        <span className="pt-time-axis-plot">{axis(view, showNow)}</span>
        <span />
      </div>
      {row('focus')}
      {row('talk')}
      {row('overview')}
      {view.focus.length === 0 && view.talk.length === 0 && view.records.length === 0
        ? <span className="pt-time-empty pt-time-empty-overview">{t('time.empty')}</span>
        : null}
    </div>
  )
}

/** The grouped rows: every entry, conversation and habit. */
function Detail({ view, showNow, timezone, sessionTitles }: {
  readonly view: TimeView
  readonly showNow: boolean
  readonly timezone: string | undefined
  readonly sessionTitles: Readonly<Record<string, string>> | undefined
}): JSX.Element {
  const t = useCopy()
  const fromMs = Date.parse(view.from)
  const toMs = Date.parse(view.to)
  return (
    <div className="pt-time-detail">
      <div className="pt-time-axis">
        <span />
        <span className="pt-time-axis-plot">{axis(view, showNow)}</span>
        <span />
      </div>
      <section className="pt-time-group">
        <GroupHead title={t('time.focus')} count={t('time.count.items', { count: view.focus.length })} />
        {view.focus.length === 0
          ? <span className="pt-time-empty">{t('list.empty')}</span>
          : view.focus.map(row => (
            <Row key={row.id} row={row} group="focus" label={row.title ?? row.id} showNow={showNow} timezone={timezone} fromMs={fromMs} toMs={toMs} />
          ))}
      </section>
      <section className="pt-time-group">
        <GroupHead title={t('time.talk')} count={t('time.count.segments', { count: view.talk.length })} />
        {view.talk.length === 0
          ? <span className="pt-time-empty">{t('time.talk.empty')}</span>
          : view.talk.map(row => (
            <Row key={row.id} row={row} group="talk" label={talkLabel(row, sessionTitles, t)} showNow={showNow} timezone={timezone} fromMs={fromMs} toMs={toMs} />
          ))}
      </section>
      <section className="pt-time-group">
        <GroupHead
          title={t('time.records')}
          count={t('time.count.items', { count: view.records.length })}
          total={durationOf(view.totals.records, t)}
        />
        {view.records.length === 0
          ? <span className="pt-time-empty">{t('list.empty')}</span>
          : view.records.map(row => (
            <Row key={row.id} row={row} group="record" label={recordLabel(row.id, t)} showNow={showNow} timezone={timezone} fromMs={fromMs} toMs={toMs} />
          ))}
      </section>
    </div>
  )
}

/** One group's title, count and (when it has one) total. */
function GroupHead({ title, count, total }: { readonly title: string; readonly count: string; readonly total?: string }): JSX.Element {
  return (
    <header className="pt-time-group-head">
      <span className="pt-time-group-title">{title}</span>
      <span className="pt-time-group-count">{count}</span>
      {total === undefined ? null : <span className="pt-time-group-total">{total}</span>}
    </header>
  )
}

/** One row: label, rail and total; the rail holds the row's blocks. */
function Row({ row, group, label, showNow, timezone, fromMs, toMs }: {
  readonly row: TimeRow
  readonly group: 'focus' | 'talk' | 'record'
  readonly label: string
  readonly showNow: boolean
  readonly timezone: string | undefined
  readonly fromMs: number
  readonly toMs: number
}): JSX.Element {
  const t = useCopy()
  return (
    <div className={`pt-time-row pt-time-row-${group}`}>
      <span className="pt-time-label" title={label}>{label}</span>
      <span className="pt-time-rail">
        {row.intervals.map((interval, index) => {
          const box = boxOf(interval, fromMs, toMs)
          return box === null ? null : (
            <span
              className={`pt-time-blk pt-time-blk-${group}`}
              key={`${interval.startedAt}-${index}`}
              style={box}
              title={blockTitle(row, interval, t, timezone, group)}
            />
          )
        })}
        {showNow ? <i className="pt-time-now-line" /> : null}
      </span>
      <span className="pt-time-total">{durationOf(row.seconds, t)}</span>
    </div>
  )
}

/** The axis labels and, while today is shown, the now dot. */
function axis(view: TimeView, showNow: boolean): JSX.Element {
  const fromMs = Date.parse(view.from)
  const toMs = Date.parse(view.to)
  return (
    <>
      {view.ticks.map((tick, index) => (
        <span
          className={`pt-time-tick${index === 0 ? ' pt-time-tick-first' : ''}${index === view.ticks.length - 1 ? ' pt-time-tick-last' : ''}`}
          key={tick.at}
          style={{ left: `${percentOf(tick.at, fromMs, toMs)}%` }}
        >{tick.label}</span>
      ))}
      {showNow ? <i className="pt-time-now-dot" /> : null}
    </>
  )
}
