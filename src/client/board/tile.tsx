/**
 * The board's visual primitives: tiles, tile headers, icon buttons, the
 * completion ring, category pills and the editable time chip.
 *
 * A tile is the unit of the board — one habit, one card — and tiles declare
 * whether they take one grid column or the full row. Everything inside a tile
 * is content; everything interactive is a button, so a tile never pretends to
 * be clickable as a whole.
 */
import type { JSX, ReactNode } from 'react'
import { useCopy } from '../copy/index.tsx'
import { FieldForm, type FieldSpec } from './fields.tsx'
import { timeField, timeOf, timeValueOf } from './format.ts'

/** How much of the grid row a tile takes. */
export type Span = 1 | 2

/** The tile's state-tinted look. */
export type Tone = 'idle' | 'done'

/** One card on the board. */
export function Tile({ span = 1, tone = 'idle', children }: {
  readonly span?: Span
  readonly tone?: Tone
  readonly children: ReactNode
}): JSX.Element {
  return <section className={`pt-tile pt-span-${span} pt-tone-${tone}`}>{children}</section>
}

/** The tile's title row: name, a right-aligned fact, and optional actions. */
export function TileHead({ title, meta, metaTitle, children }: {
  readonly title: string
  readonly meta?: string
  readonly metaTitle?: string
  readonly children?: ReactNode
}): JSX.Element {
  return (
    <header className="pt-tile-head">
      <span className="pt-tile-title">{title}</span>
      {meta === undefined ? null : <span className="pt-tile-meta" title={metaTitle}>{meta}</span>}
      {children === undefined ? null : <span className="pt-tile-actions">{children}</span>}
    </header>
  )
}

/** A small square button for a secondary action. */
export function IconButton({ label, disabled, onClick, children }: {
  readonly label: string
  readonly disabled: boolean
  readonly onClick: () => void
  readonly children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      className="pt-icon"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >{children}</button>
  )
}

/** A full-row heading that groups the tiles below it. */
export function GroupHeader({ label }: { readonly label: string }): JSX.Element {
  return (
    <div className="pt-group">
      <span>{label}</span>
    </div>
  )
}

/**
 * The empty slot of a counted habit: a dashed `＋` standing where the next
 * record will go. Callers stop rendering it once the day is full, so the tile
 * shrinks to exactly the records it holds.
 */
export function AddSlot({ label, disabled, onClick }: {
  readonly label: string
  readonly disabled: boolean
  readonly onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="pt-plus"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >＋</button>
  )
}

/** The day's completion as a ring plus the count. */
export function ProgressRing({ ratio, label, sub }: {
  readonly ratio: number
  readonly label: string
  readonly sub?: string
}): JSX.Element {
  const t = useCopy()
  const radius = 15.5
  const circumference = 2 * Math.PI * radius
  const clamped = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0
  return (
    <div className="pt-ring" role="img" aria-label={t('tile.complete', { label })}>
      <svg viewBox="0 0 40 40" width="46" height="46">
        <circle className="pt-ring-track" cx="20" cy="20" r={radius} />
        <circle
          className="pt-ring-fill"
          cx="20"
          cy="20"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span className="pt-ring-text">
        {label}
        {sub === undefined ? null : <small>{sub}</small>}
      </span>
    </div>
  )
}

/** A row of small filter pills. */
export function Pills<T extends string>({ value, options, onChange }: {
  readonly value: T
  readonly options: readonly { readonly value: T; readonly label: string }[]
  readonly onChange: (next: T) => void
}): JSX.Element {
  return (
    <div className="pt-pills">
      {options.map(option => (
        <button
          type="button"
          key={option.value}
          className={option.value === value ? 'pt-pill pt-pill-on' : 'pt-pill'}
          onClick={() => onChange(option.value)}
        >{option.label}</button>
      ))}
    </div>
  )
}

/** A recorded time: the label opens its editor, the × removes the entry. */
export function TimeChip({ instant, busy, onEdit, onRemove }: {
  readonly instant: string
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onRemove: () => void
}): JSX.Element {
  const t = useCopy()
  return (
    <span className="pt-chip-time">
      <button
        type="button"
        className="pt-chip-time-label"
        title={t('tile.editTime')}
        disabled={busy}
        onClick={onEdit}
      >{timeOf(instant)}</button>
      <button
        type="button"
        className="pt-chip-time-remove"
        title={t('tile.undoEntry')}
        disabled={busy}
        onClick={onRemove}
      >×</button>
    </span>
  )
}

/** A single-field editor for a recorded time. */
export function TimeEditor({ instant, busy, onSubmit, onCancel }: {
  readonly instant: string | null | undefined
  readonly busy: boolean
  readonly onSubmit: (time: string) => void
  readonly onCancel: () => void
}): JSX.Element {
  const t = useCopy()
  const fields: readonly FieldSpec[] = [timeField(t)]
  return (
    <FieldForm
      fields={fields}
      initial={{ time: timeValueOf(instant) }}
      submitLabel={t('form.save')}
      busy={busy}
      onSubmit={payload => onSubmit(String(payload.time))}
      onCancel={onCancel}
    />
  )
}
