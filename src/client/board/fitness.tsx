/**
 * The training tiles: running (single-valued, with derived pace), jump rope
 * (single-valued, with a free count and derived tempo), pull-ups (support
 * time), plank (hold time), gym equipment, and free-form sessions (a duration,
 * plus optional energy).
 */
import { useState, type JSX } from 'react'
import type { EquipmentSession, FreeSession, PlankSession, PullupSession } from '../types.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import { ropeDurationOf, ropeTempo, type RopeDay } from '../../shared/rope.ts'
import { FieldForm, type FieldSpec } from './fields.tsx'
import { durationText, fractionText, paceLabel, paceOf, timeField, timeOf, timeValueOf } from './format.ts'
import { SessionTile, type SessionEntry } from './session-cards.tsx'
import { IconButton, Tile, TileHead } from './tile.tsx'

/** Fields for the single running entry; the duration starts from config. */
function runFields(t: Copy, defaultMinutes: number): readonly FieldSpec[] {
  return [
    timeField(t),
    { name: 'minutes', label: t('field.minutes'), kind: 'number', min: 1, defaultValue: String(defaultMinutes) },
    { name: 'distanceKm', label: t('field.distance'), kind: 'number', step: 0.01, min: 0 },
    { name: 'avgHr', label: t('field.avgHr'), kind: 'number', min: 1, optional: true },
  ]
}

/**
 * Fields for one jump-rope day.
 *
 * The free count replaced the 90/180 preset pair, so the input is an ordinary
 * positive integer like a run's distance — the user knows how many jumps they
 * made; the app should not make them fit it into two boxes.
 */
function ropeFields(t: Copy): readonly FieldSpec[] {
  return [
    { name: 'count', label: t('field.count'), kind: 'number', min: 1 },
    { name: 'seconds', label: t('field.seconds'), kind: 'number', min: 1 },
    { name: 'avgHr', label: t('field.heartRate'), kind: 'number', min: 1, optional: true },
  ]
}

/** Fields for one pull-up set. */
function pullupFields(t: Copy): readonly FieldSpec[] {
  return [
    { name: 'seconds', label: t('field.holdSeconds'), kind: 'number', min: 0 },
  ]
}

/** Fields for one plank hold. */
function plankFields(t: Copy): readonly FieldSpec[] {
  return [
    { name: 'seconds', label: t('field.plankSeconds'), kind: 'number', min: 0 },
  ]
}

/** Fields for one equipment set. */
function equipmentFields(t: Copy): readonly FieldSpec[] {
  return [
    { name: 'name', label: t('field.equipment'), kind: 'text' },
    { name: 'reps', label: t('field.reps'), kind: 'number', min: 0 },
    { name: 'weight', label: t('field.weight'), kind: 'number', step: 0.5, min: 0, optional: true },
  ]
}

/**
 * Fields for one free-form training session.
 *
 * The duration is required and the energy is not: a watch reports kcal, a person
 * reports "an hour of badminton". Making the second field required would turn
 * every unmeasured workout into a guess.
 */
function freeFields(t: Copy): readonly FieldSpec[] {
  return [
    { name: 'minutes', label: t('field.minutes'), kind: 'number', min: 1 },
    { name: 'kcal', label: t('field.kcal'), kind: 'number', min: 0, optional: true },
  ]
}

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
  const t = useCopy()
  const [editing, setEditing] = useState(false)
  const fields = runFields(t, defaultMinutes)

  return (
    <Tile span={2} tone={run === null ? 'idle' : 'done'}>
      <TileHead
        title={t('fitness.run.title')}
        meta={run === null
          ? t('fitness.notRecorded')
          : t('fitness.run.meta', { distance: run.distanceKm, minutes: run.minutes })}
      >
        {run === null ? null : (
          <>
            <IconButton label={t('tile.edit')} disabled={busy} onClick={() => setEditing(true)}>✎</IconButton>
            <IconButton label={t('tile.remove')} disabled={busy} onClick={onClear}>×</IconButton>
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
          submitLabel={t('form.save')}
          busy={busy}
          onSubmit={(payload) => {
            onSet(payload)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : run === null ? (
        <div className="pt-tile-foot">
          <span className="pt-muted">{t('fitness.run.hint')}</span>
          <span className="pt-grow" />
          <button type="button" className="pt-primary" disabled={busy} onClick={() => setEditing(true)}>{t('fitness.record')}</button>
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

/** Handlers a session list needs, shared by the repetitive habits. */
export interface SessionHandlers {
  readonly busy: boolean
  readonly onAdd: (payload: Record<string, unknown>) => void
  readonly onPatch: (id: string, payload: Record<string, unknown>) => void
  readonly onRemove: (id: string) => void
}

/** Props for the jump-rope tile. */
export interface RopeTileProps {
  /** The day's record, with any legacy sets already merged (see shared/rope.ts). */
  readonly rope: RopeDay | null
  readonly busy: boolean
  readonly onSet: (payload: Record<string, unknown>) => void
  readonly onClear: () => void
}

/**
 * Jump rope: one record a day, like a run. The count is free — the old 90/180
 * preset pair is gone — and the tile derives tempo from count and time, which
 * is the pace-like figure that makes two different sessions comparable.
 */
export function RopeTile({ rope, busy, onSet, onClear }: RopeTileProps): JSX.Element {
  const t = useCopy()
  const [editing, setEditing] = useState(false)
  const tempo = rope === null ? undefined : ropeTempo(rope.count, rope.seconds)

  return (
    <Tile span={2} tone={rope === null ? 'idle' : 'done'}>
      <TileHead
        title={t('fitness.rope.title')}
        meta={rope === null
          ? t('fitness.notRecorded')
          : t('fitness.rope.meta', {
              count: rope.count,
              duration: durationText(ropeDurationOf(rope.seconds), t),
            })}
      >
        {rope === null ? null : (
          <>
            <IconButton label={t('tile.edit')} disabled={busy} onClick={() => setEditing(true)}>✎</IconButton>
            <IconButton label={t('tile.remove')} disabled={busy} onClick={onClear}>×</IconButton>
          </>
        )}
      </TileHead>

      {editing ? (
        <FieldForm
          fields={[timeField(t), ...ropeFields(t)]}
          // Same rule as a new run: nothing to edit means the fields' own
          // defaults (the clock) apply, rather than an empty `initial.time`
          // winning over them and opening the form blank.
          {...(rope === null
            ? {}
            : {
                initial: {
                  time: timeValueOf(rope.at),
                  count: rope.count,
                  seconds: rope.seconds,
                  avgHr: rope.avgHr,
                },
              })}
          submitLabel={t('form.save')}
          busy={busy}
          onSubmit={(payload) => {
            onSet(payload)
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : rope === null ? (
        <div className="pt-tile-foot">
          <span className="pt-muted">{t('fitness.rope.hint')}</span>
          <span className="pt-grow" />
          <button type="button" className="pt-primary" disabled={busy} onClick={() => setEditing(true)}>{t('fitness.record')}</button>
        </div>
      ) : (
        <div className="pt-metrics">
          {tempo === undefined ? null : <span>{t('unit.tempo', { tempo: fractionText(tempo) })}</span>}
          {rope.avgHr === undefined ? null : <span>♥ {rope.avgHr}</span>}
          <span className="pt-muted">{timeOf(rope.at)}</span>
        </div>
      )}
    </Tile>
  )
}

/** Pull-ups: support time per set. */
export function PullupCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly PullupSession[] }): JSX.Element {
  const t = useCopy()
  return (
    <SessionTile
      label={t('fitness.pullup.title')}
      title={t('fitness.sets')}
      entries={sessions as readonly SessionEntry[]}
      fields={pullupFields(t)}
      summarize={entry => t('fitness.pullup.summary', {
        seconds: Number(entry.seconds),
        time: timeOf(String(entry.at ?? '')),
      })}
      addLabel={t('fitness.addSet')}
      emptyLabel={t('list.empty')}
      {...handlers}
    />
  )
}

/** Plank: hold time per set. */
export function PlankCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly PlankSession[] }): JSX.Element {
  const t = useCopy()
  return (
    <SessionTile
      label={t('fitness.plank.title')}
      title={t('fitness.sets')}
      entries={sessions as readonly SessionEntry[]}
      fields={plankFields(t)}
      summarize={entry => `${Number(entry.seconds)}s · ${timeOf(String(entry.at ?? ''))}`}
      addLabel={t('fitness.addSet')}
      emptyLabel={t('list.empty')}
      {...handlers}
    />
  )
}

/** Gym equipment: name, total reps, optional weight. */
export function EquipmentCard({ sessions, ...handlers }: SessionHandlers & { readonly sessions: readonly EquipmentSession[] }): JSX.Element {
  const t = useCopy()
  return (
    <SessionTile
      label={t('fitness.equipment.title')}
      title={t('fitness.sets')}
      entries={sessions as readonly SessionEntry[]}
      fields={equipmentFields(t)}
      summarize={(entry) => {
        const params = {
          name: String(entry.name),
          reps: Number(entry.reps),
          time: timeOf(String(entry.at ?? '')),
        }
        return entry.weight === undefined
          ? t('fitness.equipment.summaryPlain', params)
          : t('fitness.equipment.summary', { ...params, weight: Number(entry.weight) })
      }}
      addLabel={t('fitness.addSet')}
      emptyLabel={t('list.empty')}
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
  const t = useCopy()
  return (
    <SessionTile
      label={t('fitness.free.title')}
      title={t('fitness.sessions')}
      entries={sessions as readonly SessionEntry[]}
      fields={freeFields(t)}
      summarize={(entry) => {
        const params = {
          minutes: Number(entry.minutes),
          time: timeOf(String(entry.at ?? '')),
        }
        return entry.kcal === undefined
          ? t('fitness.free.summaryPlain', params)
          : t('fitness.free.summary', { ...params, kcal: Number(entry.kcal) })
      }}
      addLabel={t('tile.addSession')}
      emptyLabel={t('list.empty')}
      {...handlers}
    />
  )
}
