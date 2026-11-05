/**
 * The daily cards: counted checks, the laundry counter and the three meal
 * slots. Each is a tile; nothing here talks to the API.
 */
import { useState, type JSX } from 'react'
import type { MealSlot } from '../api.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import type { DayRecord } from '../types.ts'
import { FieldForm, type FieldSpec } from './fields.tsx'
import { moneyOf, timeField, timeOf, timeValueOf } from './format.ts'
import { habitLabel } from './names.ts'
import { AddSlot, IconButton, Tile, TileHead, TimeChip, TimeEditor } from './tile.tsx'

/** Fields one meal slot exposes when edited; its own time is always known. */
function mealEditFields(t: Copy): readonly FieldSpec[] {
  return [
    timeField(t),
    {
      name: 'price',
      label: t('field.price'),
      kind: 'number',
      step: 0.5,
      min: 0,
      optional: true,
      placeholder: t('form.optional'),
    },
  ]
}

/** Props for a counted check tile (washing up twice, showering once). */
export interface CheckTileProps {
  readonly label: string
  readonly times: readonly string[]
  readonly max: number
  readonly busy: boolean
  readonly onCheck: () => void
  readonly onEdit: (index: number, time: string) => void
  readonly onRemove: (index: number) => void
}

/**
 * A check habit whose entries are individually retimable and removable.
 *
 * The tile shows one slot per entry plus — while the day is not full — a single
 * dashed `＋` for the next one: nothing when empty but the invitation, and
 * nothing to press once the day is done.
 */
export function CheckTile({ label, times, max, busy, onCheck, onEdit, onRemove }: CheckTileProps): JSX.Element {
  const t = useCopy()
  const [editing, setEditing] = useState<number | null>(null)
  const done = times.length >= max
  return (
    <Tile tone={done ? 'done' : 'idle'}>
      <TileHead title={label} meta={`${times.length}/${max}`} />
      {editing === null ? (
        <div className="pt-chips">
          {times.map((instant, index) => (
            <TimeChip
              key={`${instant}:${String(index)}`}
              instant={instant}
              busy={busy}
              onEdit={() => setEditing(index)}
              onRemove={() => onRemove(index)}
            />
          ))}
          {done ? null : <AddSlot label={t('check.mark', { label })} disabled={busy} onClick={onCheck} />}
        </div>
      ) : (
        <TimeEditor
          instant={times[editing]}
          busy={busy}
          onSubmit={(time) => {
            onEdit(editing, time)
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </Tile>
  )
}

/** Props for the laundry tile. */
export interface LaundryTileProps {
  readonly pending: number
  readonly busy: boolean
  /** Gauge adjustment: stock only, no wash event. */
  readonly onDelta: (delta: number) => void
  /** A wash happened: decrement the stock and record the event. */
  readonly onWash: (pieces: number, time?: string) => void
  /** Set the exact stock value: a correction, no event. */
  readonly onSet: (pending: number) => void
}

/**
 * The laundry counter plus its wash action. `＋`/`−` adjust the gauge (piling
 * up clothes, fixing a miscount) and leave no history; only `洗完` records a
 * washing session, with the hour it happened.
 *
 * Nothing left to wash is this tile's own idea of done, so it greens at zero.
 */
export function LaundryTile({ pending, busy, onDelta, onWash, onSet }: LaundryTileProps): JSX.Element {
  const t = useCopy()
  const [mode, setMode] = useState<'idle' | 'wash' | 'fix'>('idle')

  return (
    <Tile span={2} tone={pending === 0 ? 'done' : 'idle'}>
      <TileHead title={t('laundry.title')} meta={t('laundry.pending', { count: pending })}>
        <IconButton label={t('laundry.add')} disabled={busy} onClick={() => onDelta(1)}>＋</IconButton>
        <IconButton label={t('laundry.remove')} disabled={busy || pending <= 0} onClick={() => onDelta(-1)}>−</IconButton>
      </TileHead>
      {mode === 'idle' ? (
        <div className="pt-tile-foot">
          <span className="pt-big">{pending}</span>
          <span className="pt-muted">{t('laundry.unit')}</span>
          <span className="pt-grow" />
          <button
            type="button"
            className="pt-primary"
            disabled={busy || pending <= 0}
            onClick={() => setMode('wash')}
          >{t('laundry.wash')}</button>
          <button type="button" className="pt-ghost" disabled={busy} onClick={() => setMode('fix')}>{t('laundry.fix')}</button>
        </div>
      ) : mode === 'wash' ? (
        <FieldForm
          fields={[
            { name: 'pieces', label: t('laundry.pieces'), kind: 'number', min: 1, defaultValue: String(pending) },
            timeField(t),
          ]}
          submitLabel={t('laundry.commit')}
          busy={busy}
          onSubmit={(payload) => {
            onWash(Number(payload.pieces), typeof payload.time === 'string' ? payload.time : undefined)
            setMode('idle')
          }}
          onCancel={() => setMode('idle')}
        />
      ) : (
        <FieldForm
          fields={[{
            name: 'pending',
            label: t('laundry.setPending'),
            kind: 'number',
            min: 0,
            defaultValue: String(pending),
          }]}
          submitLabel={t('laundry.fix')}
          busy={busy}
          onSubmit={(payload) => {
            onSet(Number(payload.pending))
            setMode('idle')
          }}
          onCancel={() => setMode('idle')}
        />
      )}
    </Tile>
  )
}

/** The three meal slots, in the order the board lists them. */
const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner']

/** Props for the meal board. */
export interface MealBoardProps {
  readonly meals: DayRecord['meals']
  readonly busy: boolean
  readonly onRecord: (slot: MealSlot, options: { time?: string; price?: number }) => void
  readonly onClear: (slot: MealSlot) => void
}

/** Three compact rows: tap `＋` to stamp the time now, ✎ to retime or price it. */
export function MealBoard({ meals, busy, onRecord, onClear }: MealBoardProps): JSX.Element {
  const t = useCopy()
  const [editing, setEditing] = useState<MealSlot | null>(null)
  const recorded = MEAL_SLOTS.filter(slot => meals[slot] !== undefined).length

  return (
    <Tile span={2} tone={recorded === MEAL_SLOTS.length ? 'done' : 'idle'}>
      <TileHead title={t('meal.title')} meta={`${recorded}/3`} />
      {editing === null ? (
        <div className="pt-meals">
          {MEAL_SLOTS.map((slot) => {
            const meal = meals[slot]
            const label = habitLabel(slot, t)
            return (
              <div key={slot} className={meal === undefined ? 'pt-meal' : 'pt-meal pt-meal-done'}>
                <span className="pt-meal-label">{label}</span>
                {meal === undefined ? null : (
                  <>
                    <span className="pt-meal-time">{timeOf(meal.at)}</span>
                    {meal.price === undefined ? null : <span className="pt-meal-price">{moneyOf(meal.price)}</span>}
                  </>
                )}
                <span className="pt-meal-actions">
                  {meal === undefined
                    ? <AddSlot label={t('meal.record', { meal: label })} disabled={busy} onClick={() => onRecord(slot, {})} />
                    : (
                      <>
                        <IconButton label={t('meal.edit')} disabled={busy} onClick={() => setEditing(slot)}>✎</IconButton>
                        <IconButton label={t('meal.clear')} disabled={busy} onClick={() => onClear(slot)}>×</IconButton>
                      </>
                    )}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <FieldForm
          fields={mealEditFields(t)}
          initial={{ time: timeValueOf(meals[editing]?.at), price: meals[editing]?.price }}
          submitLabel={t('form.save')}
          busy={busy}
          onSubmit={(payload) => {
            onRecord(editing, {
              ...(typeof payload.time === 'string' ? { time: payload.time } : {}),
              ...(typeof payload.price === 'number' ? { price: payload.price } : {}),
            })
            setEditing(null)
          }}
          onCancel={() => setEditing(null)}
        />
      )}
    </Tile>
  )
}
