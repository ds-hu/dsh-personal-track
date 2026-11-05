/**
 * The statistics panel: a main-area page rather than a sidebar tab, because
 * grids and a chart need width.
 *
 * Every number arrives already aggregated from the host (src/host/stats.ts) —
 * this component only picks a range and draws. The heart-rate / pace curve is
 * the one hand-drawn SVG; everything else is CSS.
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import type { HabitClient } from '../api.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import type { ClockView, RunPoint, StatsView } from '../types.ts'
import { DataCard } from './data.tsx'
import { durationText, fractionText, mediaStatusLabel, messageOf, percentOf } from './format.ts'
import { habitLabel } from './names.ts'
import { clusterRuns } from './run-curve.ts'
import { ropeDurationOf } from '../../shared/rope.ts'
import { shiftDayKey } from '../../shared/habit-day.ts'
import { Pills, Tile, TileHead } from './tile.tsx'

/** The preset ranges the panel offers. */
type RangeKey = 'week' | 'month' | 'd30' | 'd90'

/**
 * The pills' options, named at render time: a module-level table would freeze
 * whichever language was active when the module loaded.
 */
function rangeOptions(t: Copy): readonly { readonly value: RangeKey; readonly label: string }[] {
  return [
    { value: 'week', label: t('stats.range.week') },
    { value: 'month', label: t('stats.range.month') },
    { value: 'd30', label: t('stats.range.d30') },
    { value: 'd90', label: t('stats.range.d90') },
  ]
}

/** The range a preset names, inside the given habit day. */
function presetRange(key: RangeKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'week': return { from: shiftDayKey(today, -6), to: today }
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today }
    case 'd30': return { from: shiftDayKey(today, -29), to: today }
    case 'd90': return { from: shiftDayKey(today, -89), to: today }
  }
}

/** The panellist icon: three bars. */
export function StatsIcon({ size = 16 }: { readonly size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="8" width="3" height="6" rx="1" fill="currentColor" opacity=".5" />
      <rect x="6.5" y="4" width="3" height="10" rx="1" fill="currentColor" opacity=".75" />
      <rect x="11" y="6" width="3" height="8" rx="1" fill="currentColor" />
    </svg>
  )
}

/** A titled card of label/value rows. */
function MetricCard({ title, rows }: {
  readonly title: string
  readonly rows: readonly (readonly [string, string])[]
}): JSX.Element {
  return (
    <Tile span={1}>
      <TileHead title={title} />
      <div className="pt-facts">
        {rows.map(([label, value]) => (
          <div className="pt-fact" key={`${label}:${value}`}>
            <span className="pt-muted">{label}</span>
            <span className="pt-fact-value">{value}</span>
          </div>
        ))}
      </div>
    </Tile>
  )
}

/** The habit × day heat grid. */
function HeatGrid({ stats }: { readonly stats: StatsView }): JSX.Element {
  const t = useCopy()
  return (
    <Tile span={2}>
      <TileHead
        title={t('stats.heat.title')}
        meta={t('stats.heat.meta', { days: stats.days.length, perfect: stats.perfectDays })}
      />
      <div className="pt-heat">
        {stats.habits.map(habit => (
          <div className="pt-heat-row" key={habit.id}>
            <span className="pt-heat-label">{habitLabel(habit.id, t)}</span>
            <span className="pt-heat-cells">
              {habit.perDay.map((met, index) => (
                <span
                  key={stats.days[index]?.date ?? String(index)}
                  className={met ? 'pt-heat-cell pt-heat-on' : 'pt-heat-cell'}
                  title={t('stats.heat.cell', {
                    date: stats.days[index]?.date ?? '',
                    state: t(met ? 'chip.done' : 'chip.missing'),
                  })}
                />
              ))}
            </span>
            <span className="pt-heat-count">{habit.met}/{habit.days}</span>
            <span className="pt-heat-streak">{t('stats.heat.streak', { count: habit.streak })}</span>
          </div>
        ))}
      </div>
      <div className="pt-muted">{t('stats.heat.note')}</div>
    </Tile>
  )
}

/**
 * A bucket's shade: the buckets that are present spread over the whole ramp, so
 * three of them read as pale / middle / deep rather than as three neighbours of
 * one end. The ramp is `--pt-curve-1` (palest, shortest) to `--pt-curve-5` in
 * the stylesheet, translucent green like the rest of the palette — which is what
 * lets it sit on a light and a dark shell without a second set of values.
 */
function shadeOf(index: number, count: number): string {
  const step = count <= 1 ? 4 : Math.round(index / (count - 1) * 4)
  return `var(--pt-curve-${step + 1})`
}

/**
 * The heart-rate / pace curve: one point per run that recorded both, bucketed by
 * distance and never joined across buckets.
 *
 * There is no line through the runs themselves any more. A run is a point with
 * two coordinates and a date that is not one of them, so joining consecutive
 * dates drew a relationship between runs that share nothing but being a week
 * apart. The only line left has a meaning: inside one distance bucket, the runs
 * nothing faster beats.
 */
function Curve({ points }: { readonly points: readonly RunPoint[] }): JSX.Element {
  const t = useCopy()
  if (points.length === 0) {
    return <span className="pt-muted">{t('curve.empty')}</span>
  }
  const clusters = clusterRuns(points)
  const shade = new Map(clusters.map((cluster, index) => [cluster.key, shadeOf(index, clusters.length)]))
  const width = 320
  const height = 170
  const pad = 30
  const paces = points.map(point => point.pace)
  const heartRates = points.map(point => point.avgHr)
  const minPace = Math.min(...paces)
  const maxPace = Math.max(...paces)
  const minHr = Math.min(...heartRates)
  const maxHr = Math.max(...heartRates)
  // Faster runs (smaller pace) sit further right, so progress moves right-ward
  // and — as fitness improves at the same pace — downward.
  const x = (pace: number): number =>
    pad + (maxPace === minPace ? 0.5 : (maxPace - pace) / (maxPace - minPace)) * (width - pad * 2)
  const y = (hr: number): number =>
    height - pad - (maxHr === minHr ? 0.5 : (hr - minHr) / (maxHr - minHr)) * (height - pad * 2)
  const at = (point: RunPoint): string =>
    `${x(point.pace).toFixed(1)},${y(point.avgHr).toFixed(1)}`
  const path = (frontier: readonly RunPoint[]): string =>
    frontier.map((point, index) => `${index === 0 ? 'M' : 'L'}${at(point)}`).join(' ')
  const fmt = (value: number): string => value.toFixed(1)

  return (
    <>
      <svg className="pt-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('curve.aria')}>
        <line className="pt-curve-axis" x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
        <line className="pt-curve-axis" x1={pad} y1={pad} x2={pad} y2={height - pad} />
        {clusters.map(cluster => cluster.frontier.length < 2 ? null : (
          <path
            key={`front:${cluster.key}`}
            className="pt-curve-front"
            d={path(cluster.frontier)}
            style={{ stroke: shade.get(cluster.key) }}
          />
        ))}
        {clusters.flatMap(cluster => cluster.points.map(point => (
          <circle
            key={point.date}
            cx={x(point.pace)}
            cy={y(point.avgHr)}
            r={3.4}
            // An inline style, not a `fill` attribute: the attribute loses to any
            // stylesheet rule for the element, and a `.pt-curve-dot { fill }`
            // rule is exactly what flattened this ramp into one green once.
            style={{ fill: shade.get(cluster.key) }}
          >
            <title>{t('curve.point', { date: point.date, km: point.km, pace: fmt(point.pace), hr: point.avgHr })}</title>
          </circle>
        )))}
        {clusters.flatMap(cluster => cluster.frontier.map(point => (
          <circle
            key={`flag:${point.date}`}
            className="pt-curve-flag"
            cx={x(point.pace)}
            cy={y(point.avgHr)}
            r={5.5}
            style={{ stroke: shade.get(cluster.key) }}
          />
        )))}
        <text className="pt-curve-tick" x={width / 2} y={height - 6} textAnchor="middle">{t('curve.xAxis')}</text>
        <text className="pt-curve-tick" x={pad - 4} y={pad + 4} textAnchor="end">♥{maxHr}</text>
        <text className="pt-curve-tick" x={pad - 4} y={height - pad} textAnchor="end">♥{minHr}</text>
        <text className="pt-curve-tick" x={pad} y={height - pad + 12}>{fmt(maxPace)}</text>
        <text className="pt-curve-tick" x={width - pad} y={height - pad + 12} textAnchor="end">{fmt(minPace)}</text>
      </svg>
      {clusters.length < 2 ? null : (
        <div className="pt-curve-legend">
          {clusters.map(cluster => (
            <span className="pt-curve-key" key={`key:${cluster.key}`}>
              <i style={{ background: shade.get(cluster.key) }} />
              {t('curve.legend', { km: cluster.key, count: cluster.points.length })}
            </span>
          ))}
          <span className="pt-curve-key"><span className="pt-curve-key-dash" />{t('curve.frontier')}</span>
        </div>
      )}
    </>
  )
}

/** Props handed in by the slot registration's injection face. */
export interface StatsPanelProps {
  readonly client: HabitClient
}

/** Render the statistics panel. */
export function StatsPanel({ client }: StatsPanelProps): JSX.Element {
  const t = useCopy()
  const [clock, setClock] = useState<ClockView | null>(null)
  const [preset, setPreset] = useState<RangeKey>('month')
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({})
  const [stats, setStats] = useState<StatsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Bumped after an import, so the range is re-read from the new records. */
  const [reload, setReload] = useState(0)

  const today = clock?.today ?? ''
  const range = useMemo(() => {
    if (today === '') return null
    const base = presetRange(preset, today)
    return { from: custom.from ?? base.from, to: custom.to ?? base.to }
  }, [preset, custom, today])

  useEffect(() => {
    void client.clock().then(setClock).catch((cause: unknown) => setError(messageOf(cause, t)))
  }, [client, t])

  useEffect(() => {
    if (range === null || range.from > range.to) return
    let alive = true
    setBusy(true)
    void client.stats(range.from, range.to)
      .then((value) => {
        if (!alive) return
        setStats(value)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (alive) setError(messageOf(cause, t))
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [client, range, reload, t])

  const dash = t('unit.dash')
  const registryRows: readonly (readonly [string, string])[] = stats === null ? [] : [
    [t('stats.media.finished'), `${stats.media.finished}`],
    [t('stats.media.listed'), `${stats.media.active} / ${stats.media.dropped}`],
    [t('stats.media.kinds'), `${stats.media.films} / ${stats.media.books}`],
    [t('stats.media.rating'), stats.media.avgRating === undefined ? dash : `${stats.media.avgRating}`],
    [t('stats.tasks.done'), `${stats.tasks.done}`],
    [t('stats.tasks.doneLate'), `${stats.tasks.doneLate}`],
    [t('stats.tasks.open'), `${stats.tasks.open} / ${stats.tasks.doing}`],
    [t('stats.tasks.overdue'), `${stats.tasks.overdue}`],
    [t('stats.focus.total'), t('stats.focus.detail', {
      minutes: Math.round(stats.focus.seconds / 60),
      sessions: stats.focus.sessions,
    })],
  ]

  return (
    <div className="pt-panel">
      <header className="pt-panel-head">
        <h2>{t('stats.title')}</h2>
        {range === null ? null : <span className="pt-muted">{range.from} → {range.to}</span>}
        <span className="pt-grow" />
        <Pills value={preset} options={rangeOptions(t)} onChange={setPreset} />
        <input
          className="pt-input"
          type="date"
          title={t('stats.range.from')}
          max={today === '' ? undefined : today}
          value={custom.from ?? range?.from ?? ''}
          onChange={event => setCustom(current => ({ ...current, from: event.target.value }))}
        />
        <input
          className="pt-input"
          type="date"
          title={t('stats.range.to')}
          max={today === '' ? undefined : today}
          value={custom.to ?? range?.to ?? ''}
          onChange={event => setCustom(current => ({ ...current, to: event.target.value }))}
        />
        <button type="button" className="pt-ghost" disabled={busy} onClick={() => setCustom({})}>{t('stats.range.reset')}</button>
      </header>

      {error === null ? null : <div className="pt-error">{error}</div>}
      {stats === null
        ? <div className="pt-muted">{t('stats.loading')}</div>
        : (
          <>
            <HeatGrid stats={stats} />

            <div className="pt-cards">
              <MetricCard title={t('habit.vocab')} rows={[
                [t('stats.row.newReview'), `${stats.vocab.new} / ${stats.vocab.review}`],
                [t('stats.row.minutes'), t('unit.minutes', { minutes: stats.vocab.minutes })],
                [t('stats.row.daysMet'), `${stats.vocab.daysMet} / ${stats.days.length}`],
                [t('stats.row.surplus'), `${stats.vocab.surplus}`],
              ]} />
              <MetricCard title={t('habit.duolingo')} rows={[
                [t('stats.row.lessons'), `${stats.duolingo.lessons}`],
                [t('stats.row.duration'), t('unit.minutes', { minutes: stats.duolingo.minutes })],
                [t('stats.row.daysMet'), `${stats.duolingo.daysMet} / ${stats.days.length}`],
              ]} />
              <MetricCard title={t('stats.card.run')} rows={[
                [t('stats.row.runs'), `${stats.runs.count}`],
                [t('stats.row.km'), `${stats.runs.km} km`],
                [t('stats.row.avgHr'), stats.runs.avgHr === undefined ? dash : `${stats.runs.avgHr}`],
              ]} />
              <MetricCard title={t('stats.card.rope')} rows={[
                [t('stats.row.ropeDays'), `${stats.rope.days}`],
                [t('stats.row.totalJumps'), `${stats.rope.count}`],
                [t('stats.row.minutes'), durationText(ropeDurationOf(stats.rope.seconds), t)],
                // One rate over the range's totals: averaging per-record rates
                // would let a 2-minute sprint outweigh a 20-minute session.
                [t('stats.row.tempo'), stats.rope.tempo === undefined
                  ? dash
                  : t('report.tempo', { tempo: fractionText(stats.rope.tempo) })],
                [t('stats.row.avgHr'), stats.rope.avgHr === undefined ? dash : `${stats.rope.avgHr}`],
              ]} />
              <MetricCard title={t('stats.card.pullup')} rows={[
                [t('stats.row.sets'), `${stats.pullup.sets}`],
                [t('stats.row.hold'), t('unit.seconds', { seconds: stats.pullup.seconds })],
              ]} />
              <MetricCard title={t('stats.card.plank')} rows={[
                [t('stats.row.sets'), `${stats.plank.sets}`],
                [t('stats.row.hold'), t('unit.seconds', { seconds: stats.plank.seconds })],
              ]} />
              <MetricCard title={t('stats.card.equipment')} rows={[
                [t('stats.row.setsAndMoves'), `${stats.equipment.sets} / ${stats.equipment.reps}`],
                ...stats.equipment.byName.slice(0, 3)
                  .map(entry => [
                    entry.weight === undefined ? entry.name : `${entry.name} ${entry.weight}kg`,
                    t('stats.equipment.entry', { sets: entry.sets, reps: entry.reps }),
                  ] as const),
              ]} />
              <MetricCard title={t('stats.card.free')} rows={[
                [t('stats.row.sessions'), `${stats.free.sessions}`],
                [t('stats.row.minutes'), t('unit.minutes', { minutes: stats.free.minutes })],
                // Only unmeasured sessions are the reason the two counts can
                // differ, so the caveat appears exactly when it applies.
                ...(stats.free.sessions === stats.free.kcalSessions
                  ? [[t('stats.row.kcal'), stats.free.kcal === 0 ? dash : t('report.free.kcal', { kcal: stats.free.kcal })] as const]
                  : [[t('stats.row.kcal'), t('stats.free.kcalMeasured', {
                    kcal: stats.free.kcal,
                    count: stats.free.kcalSessions,
                  })] as const]),
              ]} />
              <MetricCard title={t('laundry.title')} rows={[
                [t('stats.row.washes'), `${stats.washing.count}`],
                [t('stats.row.pieces'), `${stats.washing.pieces}`],
              ]} />
              <MetricCard title={t('meal.title')} rows={[
                [t('stats.row.breakfast'), t('stats.meals.breakfastValue', {
                  days: stats.meals.breakfast.days,
                  percent: percentOf(stats.meals.breakfast.ratio),
                })],
                [t('stats.row.spend'), `¥${stats.meals.spend}`],
              ]} />
            </div>

            <div className="pt-columns">
              <Tile span={1}>
                <TileHead
                  title={t('curve.title')}
                  meta={t('curve.points', { count: stats.runs.points.length })}
                />
                <Curve points={stats.runs.points} />
              </Tile>
              <Tile span={1}>
                <TileHead title={t('stats.registry.title')} />
                <div className="pt-facts">
                  {registryRows.map(([label, value]) => (
                    <div className="pt-fact" key={label}>
                      <span className="pt-muted">{label}</span>
                      <span className="pt-fact-value">{value}</span>
                    </div>
                  ))}
                </div>
                {stats.media.recently.length === 0 ? null : (
                  <div className="pt-list">
                    {stats.media.recently.map(entry => (
                      <div className="pt-list-row" key={entry.id}>
                        <span className="pt-list-text">
                          <span className="pt-badge">{entry.kind === 'film' ? t('focus.kind.film') : t('focus.kind.book')}</span>
                          {' '}
                          {entry.title}
                          <span className="pt-muted"> · {mediaStatusLabel(entry.status, t)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Tile>
            </div>

            <DataCard client={client} onImported={() => setReload(value => value + 1)} />
          </>
        )}
    </div>
  )
}
