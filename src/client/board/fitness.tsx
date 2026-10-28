/**
 * The training tiles: running (single-valued, with derived pace), jump rope
 * (fixed-count sets), pull-ups (support time), plank (hold time), gym
 * equipment, and free-form sessions (a duration, plus optional energy).
 */
import { useState, type JSX } from 'react'
import type { EquipmentSession, FreeSession, PlankSession, PullupSession, RopeSession } from '../types.ts'
import { FieldForm, type FieldSpec } from './fields.tsx'
import { paceLabel, paceOf, timeField, timeOf, timeValueOf } from './format.ts'
import { SessionTile, type SessionEntry } from './session-cards.tsx'
import { IconButton, Tile, TileHead } from './tile.tsx'

/** Fields for the single running entry; the duration starts from config. */
function runFields(defaultMinutes: number): readonly FieldSpec[] {
  return [
    timeField(),
    { name: 'minutes', label: '时长(分)', kind: 'number', min: 1, defaultValue: String(defaultMinutes) },
    { name: 'distanceKm', label: '里程(km)', kind: 'number', step: 0.01, min: 0 },
    { name: 'avgHr', label: '平均心率', kind: 'number', min: 1, optional: true },
  ]
}

/** Fields for one jump-rope set. */
const ROPE_FIELDS: readonly FieldSpec[] = [
  {
    name: 'preset',
    label: '定数',
    kind: 'select',
    numericOptions: true,
    defaultValue: '90',
    options: [{ value: '90', label: '90' }, { value: '180', label: '180' }],
  },
  { name: 'seconds', label: '用时(秒)', kind: 'number', min: 1 },
  { name: 'avgHr', label: '心率', kind: 'number', min: 1, optional: true },
]

/** Fields for one pull-up set. */
const PULLUP_FIELDS: readonly FieldSpec[] = [
  { name: 'seconds', label: '支撑(秒)', kind: 'number', min: 0 },
]

/** Fields for one plank hold. */
const PLANK_FIELDS: readonly FieldSpec[] = [
  { name: 'seconds', label: '秒数', kind: 'number', min: 0 },
]

/** Fields for one equipment set. */
const EQUIPMENT_FIELDS: readonly FieldSpec[] = [
  { name: 'name', label: '器材', kind: 'text' },
  { name: 'reps', label: '动作数', kind: 'number', min: 0 },
  { name: 'weight', label: '重量(kg)', kind: 'number', step: 0.5, min: 0, optional: true },
]

/**
 * Fields for one free-form training session.
 *
 * The duration is required and the energy is not: a watch reports kcal, a person
 * reports "an hour of badminton". Making the second field required would turn
 * every unmeasured workout into a guess.
 */
const FREE_FIELDS: readonly FieldSpec[] = [
  { name: 'minutes', label: '时长(分)', kind: 'number', min: 1 },
  { name: 'kcal', label: '消耗(kcal)', kind: 'number', min: 0, optional: true },
]

/** The running entry the tile renders. */
export interface RunEntry {
  readonly at: string
  readonly minutes: number
  readonly distanceKm: number
  readonly avgHr?: number
}

/** Props for the running tile. */
export interface RunCardProps {
  readonly run: RunEntry | null
  readonly defaultMinutes: number
  readonly busy: boolean
  readonly onSet: (payload: Record<string, unknown>) => void
  readonly onClear: () => void
}

/** Running: at most one entry a day, with pace derived for display. */
export function RunTile({ run, defaultMinutes, busy, onSet, onClear }: RunCardProps): JSX.Element {
  const [editing, setEditing] = useState(false)
  const fields = runFields(defaultMinutes)

  return (
    <Tile span={2} tone={run === null ? 'idle' : 'done'}>
      <TileHead
        title="跑步"
        meta={run === null ? '未记录' : `${run.distanceKm} km · ${run.minutes} 分`}
      >
        {run === null ? null : (
          <>
            <IconButton label="编辑" disabled={busy} onClick={() => setEditing(true)}>✎</IconButton>
            <IconButton label="删除" disabled={busy} onClick={onClear}>×</IconButton>
          </>
        )}
      </TileHead>

      {editing ? (
        <FieldForm
          fields={fields}
          // Nothing to edit means nothing to pre-fill with: passing the day's
          // absent run through would hand over `initial.time = ''` (and an
          // undefined `minutes`), which wins over the field defaults and opens
          // the form blank instead of at the current time. The fields' own
          // defaults — the clock, and `defaultMinutes` — are what a new run
          // starts from.
          {...(run === null
            ? {}
            : {
                initial: {
                  time: timeValueOf(run.at),
                  minutes: run.minutes,
                  distanceKm: run.distanceKm,
                  avgHr: run.avgHr,
                },
              })}
          submitLabel="保存"
          busy={busy}
          onSubmit={(payload) => {
            onSet(payload)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : run === null ? (
        <div className="pt-tile-foot">
          <span className="pt-muted">默认 30 分钟，记里程与平均心率</span>
          <span className="pt-grow" />
          <button type="button" className="pt-primary" disabled={busy} onClick={() => setEditing(true)}>记录</button>
        </div>
      ) : (
        <div className="pt-metrics">
          <span>{paceLabel(paceOf(run.minutes, run.distanceKm))}</span>
          {run.avgHr === undefined ? null : <span>♥ {run.avgHr}</span>}
          <span className="pt-muted">{timeOf(run.at)}</span>
        </div>
      )}
    </Tile>
  )
}

/** Handlers a session tile needs, shared by the three repetitive habits. */
export interface SessionHandlers {
  readonly busy: boolean
  readonly onAdd: (payload: Record<string, unknown>) => void
  readonly onPatch: (id: string, payload: Record<string, unknown>) => void
  readonly onRemove: (id: string) => void
}

/** Jump rope: 90 or 180 count sets, any number a day. */
export function RopeCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly RopeSession[] }): JSX.Element {
  return (
    <SessionTile
      label="跳绳"
      title="组数"
      entries={sessions as readonly SessionEntry[]}
      fields={ROPE_FIELDS}
      summarize={entry => `${Number(entry.preset)} 定数 · ${Number(entry.seconds)}s${entry.avgHr === undefined ? '' : ` · ♥${Number(entry.avgHr)}`} · ${timeOf(String(entry.at ?? ''))}`}
      addLabel="加一组"
      emptyLabel="无记录"
      {...handlers}
    />
  )
}

/** Pull-ups: support time per set. */
export function PullupCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly PullupSession[] }): JSX.Element {
  return (
    <SessionTile
      label="引体向上"
      title="组数"
      entries={sessions as readonly SessionEntry[]}
      fields={PULLUP_FIELDS}
      summarize={entry => `支撑 ${Number(entry.seconds)}s · ${timeOf(String(entry.at ?? ''))}`}
      addLabel="加一组"
      emptyLabel="无记录"
      {...handlers}
    />
  )
}

/** Plank: hold time per set. */
export function PlankCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly PlankSession[] }): JSX.Element {
  return (
    <SessionTile
      label="平板支撑"
      title="组数"
      entries={sessions as readonly SessionEntry[]}
      fields={PLANK_FIELDS}
      summarize={entry => `${Number(entry.seconds)}s · ${timeOf(String(entry.at ?? ''))}`}
      addLabel="加一组"
      emptyLabel="无记录"
      {...handlers}
    />
  )
}

/** Gym equipment: name, total reps, optional weight. */
export function EquipmentCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly EquipmentSession[] }): JSX.Element {
  return (
    <SessionTile
      label="健身器材"
      title="组数"
      entries={sessions as readonly SessionEntry[]}
      fields={EQUIPMENT_FIELDS}
      summarize={entry => `${String(entry.name)} · ${Number(entry.reps)} 次${entry.weight === undefined ? '' : ` · ${Number(entry.weight)}kg`} · ${timeOf(String(entry.at ?? ''))}`}
      addLabel="加一组"
      emptyLabel="无记录"
      {...handlers}
    />
  )
}

/**
 * Free-form training: a duration, plus the energy a device measured.
 *
 * The sixth and last way to train, for work with no shape of its own — a swim, a
 * class, a game. It is an ordinary session list, so it can be retimed and
 * edited like every other one, and it fills the 健身 cell exactly as a set does.
 */
export function FreeCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly FreeSession[] }): JSX.Element {
  return (
    <SessionTile
      label="自由锻炼"
      title="次数"
      entries={sessions as readonly SessionEntry[]}
      fields={FREE_FIELDS}
      summarize={entry => `${Number(entry.minutes)} 分${entry.kcal === undefined ? '' : ` · ${Number(entry.kcal)} kcal`} · ${timeOf(String(entry.at ?? ''))}`}
      addLabel="加一次"
      emptyLabel="无记录"
      {...handlers}
    />
  )
}
