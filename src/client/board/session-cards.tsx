/**
 * The generic session list: a sub-header with an add action, then one row per
 * stored entry that can be edited in place (time and metrics) or deleted.
 *
 * Every session-bearing habit except jump rope — vocabulary, duolingo,
 * pull-ups, plank, equipment, free-form training — is this list plus a field
 * description and a one-line summary, so
 * the editing behaviour is identical everywhere. Jump rope is the single-record
 * exception (see `RopeTile`), because it answers the same question a run does.
 * The clock-time field is added here, which is why every session can be retimed
 * without extra code.
 */
import { useReducer, type JSX } from 'react'
import { useCopy } from '../copy/index.tsx'
import { IDLE, editor, isAdding, isEditing, type EditorAction, type EditorState } from './editor-state.ts'
import { FieldForm, type FieldSpec } from './fields.tsx'
import { timeField, timeValueOf } from './format.ts'
import { IconButton, Tile, TileHead } from './tile.tsx'

/** A stored session entry: an id plus whatever metrics its kind carries. */
export type SessionEntry = { readonly id: string } & Record<string, unknown>

/** Props for the list (and for the tile that wraps it). */
export interface SessionListProps {
  /** Heading shown in the list's own sub-header. */
  readonly title: string
  readonly entries: readonly SessionEntry[]
  readonly fields: readonly FieldSpec[]
  /** One line describing an entry, e.g. `07:12 · 30 分钟`. */
  readonly summarize: (entry: SessionEntry) => string
  readonly busy: boolean
  readonly addLabel?: string
  readonly emptyLabel?: string
  readonly onAdd: (payload: Record<string, unknown>) => void
  readonly onPatch: (id: string, payload: Record<string, unknown>) => void
  readonly onRemove: (id: string) => void
}

/** The list without a tile, so it can live inside another tile. */
export function SessionList({
  title, entries, fields, summarize, busy, addLabel, emptyLabel, onAdd, onPatch, onRemove,
}: SessionListProps): JSX.Element {
  const t = useCopy()
  const [mode, dispatch] = useReducer(
    (state: EditorState, action: EditorAction) => editor(state, action, entries.map(entry => entry.id)),
    IDLE,
  )
  // Built per render so the add form opens on the current clock time; an entry
  // being edited overrides it through `initial` below.
  const allFields: readonly FieldSpec[] = [timeField(t), ...fields]

  return (
    <>
      <div className="pt-sub-head">
        <span className="pt-sub-title">{title}</span>
        {entries.length === 0 ? <span className="pt-muted">{emptyLabel ?? t('list.empty')}</span> : null}
        <IconButton
          label={addLabel ?? t('tile.add')}
          disabled={busy}
          onClick={() => dispatch({ kind: 'open-add' })}
        >＋</IconButton>
      </div>

      {entries.map(entry => (isEditing(mode, entry.id)
        ? (
          <FieldForm
            key={entry.id}
            fields={allFields}
            initial={{ time: timeValueOf(String(entry.at ?? '')), ...entry }}
            submitLabel={t('form.save')}
            busy={busy}
            onSubmit={(payload) => {
              onPatch(entry.id, payload)
              dispatch({ kind: 'close' })
            }}
            onCancel={() => dispatch({ kind: 'close' })}
          />
        )
        : (
          <div className="pt-list-row" key={entry.id}>
            <span className="pt-list-text">{summarize(entry)}</span>
            <IconButton label={t('tile.edit')} disabled={busy} onClick={() => dispatch({ kind: 'edit', id: entry.id })}>✎</IconButton>
            <IconButton label={t('tile.remove')} disabled={busy} onClick={() => onRemove(entry.id)}>×</IconButton>
          </div>
        )))}

      {isAdding(mode)
        ? (
          <FieldForm
            fields={allFields}
            submitLabel={t('tile.add')}
            busy={busy}
            onSubmit={(payload) => {
              onAdd(payload)
              dispatch({ kind: 'close' })
            }}
            onCancel={() => dispatch({ kind: 'close' })}
          />
        )
        : null}
    </>
  )
}

/**
 * The list as its own full-width tile.
 *
 * These habits carry no quantity target — a single stored entry is what
 * satisfies the day — so the tile greens up as soon as the list is not empty.
 * A session habit with a target of its own builds its `Tile` itself instead
 * (see `VocabCard`), which is why there is no tone prop here.
 */
export function SessionTile({ label, title, ...list }: SessionListProps & { readonly label: string }): JSX.Element {
  const t = useCopy()
  const tone = list.entries.length > 0 ? 'done' : 'idle'
  return (
    <Tile span={2} tone={tone}>
      <TileHead title={label} meta={t('tile.entries', { count: list.entries.length })} />
      <SessionList title={title} {...list} />
    </Tile>
  )
}
