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
import type { ClockView, RunPoint, StatsView } from '../types.ts'
import { DataCard } from './data.tsx'
import { mediaStatusLabel, messageOf, percentOf, shiftKey } from './format.ts'
import { Pills, Tile, TileHead } from './tile.tsx'

/** The preset ranges the panel offers. */
type RangeKey = 'week' | 'month' | 'd30' | 'd90'

const RANGES: readonly { readonly value: RangeKey; readonly label: string }[] = [
  { value: 'week', label: '近 7 天' },
  { value: 'month', label: '本月' },
  { value: 'd30', label: '近 30 天' },
  { value: 'd90', label: '近 90 天' },
]

/** Display names for the seven habits. */
const HABIT_LABELS: Record<string, string> = {
  wash: '洗漱',
  shower: '洗澡',
  breakfast: '早饭',
  lunch: '午饭',
  dinner: '晚饭',
  vocab: '背单词',
  duolingo: '多邻国',
}

/** The range a preset names, inside the given habit day. */
function presetRange(key: RangeKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'week': return { from: shiftKey(today, -6), to: today }
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today }
    case 'd30': return { from: shiftKey(today, -29), to: today }
    case 'd90': return { from: shiftKey(today, -89), to: today }
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
  return (
    <Tile span={2}>
      <TileHead
        title="完成热力图"
        meta={`${stats.days.length} 天 · 完美日 ${stats.perfectDays}`}
      />
      <div className="pt-heat">
        {stats.habits.map(habit => (
          <div className="pt-heat-row" key={habit.id}>
            <span className="pt-heat-label">{HABIT_LABELS[habit.id] ?? habit.id}</span>
            <span className="pt-heat-cells">
              {habit.perDay.map((met, index) => (
                <span
                  key={stats.days[index]?.date ?? String(index)}
                  className={met ? 'pt-heat-cell pt-heat-on' : 'pt-heat-cell'}
                  title={`${stats.days[index]?.date ?? ''}　${met ? '完成' : '未完成'}`}
                />
              ))}
            </span>
            <span className="pt-heat-count">{habit.met}/{habit.days}</span>
            <span className="pt-heat-streak">连续 {habit.streak}</span>
          </div>
        ))}
      </div>
      <div className="pt-muted">每格一天；「连续」是到区间结束为止的连续达标天数</div>
    </Tile>
  )
}

/** The heart-rate / pace curve: one point per run that recorded both. */
function Curve({ points }: { readonly points: readonly RunPoint[] }): JSX.Element {
  if (points.length === 0) {
    return <span className="pt-muted">这段时间没有同时记录了里程与心率的跑步</span>
  }
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
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.pace).toFixed(1)},${y(point.avgHr).toFixed(1)}`)
    .join(' ')
  const fmt = (value: number): string => value.toFixed(1)

  return (
    <svg className="pt-curve" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="心率-配速曲线">
      <line className="pt-curve-axis" x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} />
      <line className="pt-curve-axis" x1={pad} y1={pad} x2={pad} y2={height - pad} />
      <path className="pt-curve-line" d={path} />
      {points.map(point => (
        <circle
          key={point.date}
          className="pt-curve-dot"
          cx={x(point.pace)}
          cy={y(point.avgHr)}
          r={3}
        >
          <title>{`${point.date} · ${fmt(point.pace)} 分/km · ♥${point.avgHr} · ${point.km}km`}</title>
        </circle>
      ))}
      <text className="pt-curve-tick" x={width / 2} y={height - 6} textAnchor="middle">配速（越右越快）</text>
      <text className="pt-curve-tick" x={pad - 4} y={pad + 4} textAnchor="end">♥{maxHr}</text>
      <text className="pt-curve-tick" x={pad - 4} y={height - pad} textAnchor="end">♥{minHr}</text>
      <text className="pt-curve-tick" x={pad} y={height - pad + 12}>{fmt(maxPace)}</text>
      <text className="pt-curve-tick" x={width - pad} y={height - pad + 12} textAnchor="end">{fmt(minPace)}</text>
    </svg>
  )
}

/** Props handed in by the slot registration's injection face. */
export interface StatsPanelProps {
  readonly client: HabitClient
}

/** Render the statistics panel. */
export function StatsPanel({ client }: StatsPanelProps): JSX.Element {
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
    void client.clock().then(setClock).catch((cause: unknown) => setError(messageOf(cause)))
  }, [client])

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
        if (alive) setError(messageOf(cause))
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [client, range, reload])

  const registryRows: readonly (readonly [string, string])[] = stats === null ? [] : [
    ['完成（区间）', `${stats.media.finished}`],
    ['在列 / 弃', `${stats.media.active} / ${stats.media.dropped}`],
    ['电影 / 书', `${stats.media.films} / ${stats.media.books}`],
    ['平均评分', stats.media.avgRating === undefined ? '——' : `${stats.media.avgRating}`],
    ['任务完成（区间）', `${stats.tasks.done}`],
    ['其中逾期完成', `${stats.tasks.doneLate}`],
    ['未完成 / 进行中', `${stats.tasks.open} / ${stats.tasks.doing}`],
    ['当前逾期', `${stats.tasks.overdue}`],
    ['累计专注', `${Math.round(stats.focus.seconds / 60)} 分（${stats.focus.sessions} 段）`],
  ]

  return (
    <div className="pt-panel">
      <header className="pt-panel-head">
        <h2>习惯统计</h2>
        {range === null ? null : <span className="pt-muted">{range.from} → {range.to}</span>}
        <span className="pt-grow" />
        <Pills value={preset} options={RANGES} onChange={setPreset} />
        <input
          className="pt-input"
          type="date"
          title="自定义起始日"
          max={today === '' ? undefined : today}
          value={custom.from ?? range?.from ?? ''}
          onChange={event => setCustom(current => ({ ...current, from: event.target.value }))}
        />
        <input
          className="pt-input"
          type="date"
          title="自定义结束日"
          max={today === '' ? undefined : today}
          value={custom.to ?? range?.to ?? ''}
          onChange={event => setCustom(current => ({ ...current, to: event.target.value }))}
        />
        <button type="button" className="pt-ghost" disabled={busy} onClick={() => setCustom({})}>默认范围</button>
      </header>

      {error === null ? null : <div className="pt-error">{error}</div>}
      {stats === null
        ? <div className="pt-muted">加载中…</div>
        : (
          <>
            <HeatGrid stats={stats} />

            <div className="pt-cards">
              <MetricCard title="背单词" rows={[
                ['新词 / 复习', `${stats.vocab.new} / ${stats.vocab.review}`],
                ['总时长', `${stats.vocab.minutes} 分`],
                ['达标天数', `${stats.vocab.daysMet} / ${stats.days.length}`],
                ['超额', `${stats.vocab.surplus}`],
              ]} />
              <MetricCard title="多邻国" rows={[
                ['节数', `${stats.duolingo.lessons}`],
                ['时长', `${stats.duolingo.minutes} 分`],
                ['达标天数', `${stats.duolingo.daysMet} / ${stats.days.length}`],
              ]} />
              <MetricCard title="跑步" rows={[
                ['次数', `${stats.runs.count}`],
                ['里程', `${stats.runs.km} km`],
                ['平均心率', stats.runs.avgHr === undefined ? '——' : `${stats.runs.avgHr}`],
              ]} />
              <MetricCard title="跳绳" rows={[
                ['组数', `${stats.rope.sets}`],
                ['90 / 180 定数', `${stats.rope.sets90} / ${stats.rope.sets180}`],
                ['总时长', `${stats.rope.seconds} 秒`],
                ['平均心率', stats.rope.avgHr === undefined ? '——' : `${stats.rope.avgHr}`],
              ]} />
              <MetricCard title="引体向上" rows={[
                ['组数', `${stats.pullup.sets}`],
                ['支撑总时长', `${stats.pullup.seconds} 秒`],
              ]} />
              <MetricCard title="平板支撑" rows={[
                ['组数', `${stats.plank.sets}`],
                ['支撑总时长', `${stats.plank.seconds} 秒`],
              ]} />
              <MetricCard title="健身器材" rows={[
                ['组数 / 动作数', `${stats.equipment.sets} / ${stats.equipment.reps}`],
                ...stats.equipment.byName.slice(0, 3)
                  .map(entry => [
                    entry.weight === undefined ? entry.name : `${entry.name} ${entry.weight}kg`,
                    `${entry.sets} 组 · ${entry.reps} 次`,
                  ] as const),
              ]} />
              <MetricCard title="洗衣" rows={[
                ['洗涤次数', `${stats.washing.count}`],
                ['总件数', `${stats.washing.pieces}`],
              ]} />
              <MetricCard title="三餐" rows={[
                ['早饭打卡', `${stats.meals.breakfast.days} 天（${percentOf(stats.meals.breakfast.ratio)}%）`],
                ['总花费', `¥${stats.meals.spend}`],
              ]} />
            </div>

            <div className="pt-columns">
              <Tile span={1}>
                <TileHead title="心率-配速曲线" meta={`${stats.runs.points.length} 个点`} />
                <Curve points={stats.runs.points} />
              </Tile>
              <Tile span={1}>
                <TileHead title="登记" />
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
                          <span className="pt-badge">{entry.kind === 'film' ? '影' : '书'}</span>
                          {' '}
                          {entry.title}
                          <span className="pt-muted"> · {mediaStatusLabel(entry.status)}</span>
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
