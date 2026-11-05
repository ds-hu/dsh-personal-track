/**
 * The study tiles: vocabulary (a quantity target plus its sessions) and
 * duolingo (a presence target: one lesson satisfies the day).
 */
import { useState, type JSX } from 'react'
import type { Lesson, VocabProgress, VocabSession } from '../types.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import { FieldForm, type FieldSpec } from './fields.tsx'
import { percentOf, timeOf } from './format.ts'
import { SessionList, SessionTile, type SessionEntry } from './session-cards.tsx'
import { IconButton, Tile, TileHead } from './tile.tsx'

/** Metrics one vocabulary session carries (the list adds the time field). */
function vocabFields(t: Copy): readonly FieldSpec[] {
  return [
    { name: 'new', label: t('field.newWords'), kind: 'number', min: 0 },
    { name: 'review', label: t('field.review'), kind: 'number', min: 0 },
    { name: 'minutes', label: t('field.minutesUsed'), kind: 'number', min: 0 },
  ]
}

/** Metrics one lesson carries. */
function lessonFields(t: Copy): readonly FieldSpec[] {
  return [
    { name: 'minutes', label: t('field.minutesUsed'), kind: 'number', min: 0 },
  ]
}

/** Props for the vocabulary tile. */
export interface VocabCardProps {
  readonly target: { readonly new: number; readonly review: number }
  readonly progress: VocabProgress
  readonly sessions: readonly VocabSession[]
  readonly busy: boolean
  readonly onTarget: (target: { new: number; review: number }) => void
  readonly onAdd: (payload: Record<string, unknown>) => void
  readonly onPatch: (id: string, payload: Record<string, unknown>) => void
  readonly onRemove: (id: string) => void
}

/**
 * Vocabulary: progress against today's snapshot, an editor for that snapshot,
 * and the sessions the progress is derived from.
 *
 * The head reports the *weighted* percentage, because that is the only figure
 * that means "the target is met": a review word counts a fifth of a new word
 * (see the host's `vocabProgress`). The two raw counts stay visible beside it.
 */
export function VocabCard({
  target, progress, sessions, busy, onTarget, onAdd, onPatch, onRemove,
}: VocabCardProps): JSX.Element {
  const t = useCopy()
  const [editing, setEditing] = useState(false)
  const surplus = progress.surplusNew + progress.surplusReview
  const percent = percentOf(progress.ratio)

  return (
    <Tile span={2} tone={progress.met ? 'done' : 'idle'}>
      <TileHead
        title={t('habit.vocab')}
        meta={`${percent}%`}
        metaTitle={t('study.vocab.weighting')}
      >
        <IconButton label={t('study.vocab.editTarget')} disabled={busy} onClick={() => setEditing(value => !value)}>✎</IconButton>
      </TileHead>

      <div className="pt-metrics">
        <span>{t('study.vocab.new', { done: progress.doneNew })}<small>/{progress.targetNew}</small></span>
        <span>{t('study.vocab.review', { done: progress.doneReview })}<small>/{progress.targetReview}</small></span>
        <span>{t('unit.minutes', { minutes: progress.minutes })}</span>
        {surplus === 0 ? null : <span className="pt-muted">{t('study.vocab.surplus', { surplus })}</span>}
      </div>
      <div className="pt-bar">
        <div className="pt-bar-fill" style={{ width: `${percent}%` }} />
      </div>

      {editing ? (
        <FieldForm
          fields={[
            { name: 'new', label: t('study.vocab.targetNew'), kind: 'number', min: 0, defaultValue: String(target.new) },
            { name: 'review', label: t('study.vocab.targetReview'), kind: 'number', min: 0, defaultValue: String(target.review) },
          ]}
          submitLabel={t('study.vocab.saveTarget')}
          busy={busy}
          onSubmit={(payload) => {
            onTarget({ new: Number(payload.new), review: Number(payload.review) })
            setEditing(false)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      <SessionList
        title={t('study.log')}
        entries={sessions as readonly SessionEntry[]}
        fields={vocabFields(t)}
        summarize={entry => t('study.vocab.summary', {
          time: timeOf(String(entry.at ?? '')),
          new: Number(entry.new),
          review: Number(entry.review),
          minutes: Number(entry.minutes),
        })}
        busy={busy}
        addLabel={t('tile.addSession')}
        onAdd={onAdd}
        onPatch={onPatch}
        onRemove={onRemove}
      />
    </Tile>
  )
}

/** Props for the duolingo tile. */
export interface DuolingoCardProps {
  readonly lessons: readonly Lesson[]
  readonly busy: boolean
  readonly onAdd: (payload: Record<string, unknown>) => void
  readonly onPatch: (id: string, payload: Record<string, unknown>) => void
  readonly onRemove: (id: string) => void
}

/** Duolingo: any number of lessons a day; one is enough for the cell. */
export function DuolingoCard({ lessons, busy, onAdd, onPatch, onRemove }: DuolingoCardProps): JSX.Element {
  const t = useCopy()
  const total = lessons.reduce((sum, lesson) => sum + lesson.minutes, 0)
  return (
    <SessionTile
      label={lessons.length === 0
        ? t('habit.duolingo')
        : t('study.duolingo.label', { lessons: lessons.length, minutes: total })}
      title={t('study.log')}
      entries={lessons as readonly SessionEntry[]}
      fields={lessonFields(t)}
      summarize={entry => t('study.lesson.summary', {
        time: timeOf(String(entry.at ?? '')),
        minutes: Number(entry.minutes),
      })}
      busy={busy}
      addLabel={t('study.addLesson')}
      onAdd={onAdd}
      onPatch={onPatch}
      onRemove={onRemove}
    />
  )
}
