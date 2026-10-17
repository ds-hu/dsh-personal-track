/**
 * The registry tiles: media (a consumption log) and tasks (a task-shaped
 * registry whose lifecycle state the host derives from progress).
 *
 * Both lists are global — they do not belong to a habit day — so their editor
 * patches a record and the board then re-reads the day it is showing.
 *
 * Editing rule: an optional field the user empties is sent as `null` **only
 * when the record actually had it**, so a patch that leaves a field alone can
 * never silently clear it.
 */
import { useReducer, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import type { MediaInput, MediaPatch, TaskInput, TaskPatch } from '../api.ts'
import type { MediaEntry, TaskEntry } from '../types.ts'
import { IDLE, editor, isAdding, isEditing, type EditorAction, type EditorState } from './editor-state.ts'
import { FieldForm, type FieldSpec } from './fields.tsx'
import { dueLevelOf, fractionText, formatCheckpoints, mediaStatusLabel, parseCheckpoints, percentOf, timeOf, weekEndKey } from './format.ts'
import { byDeadline } from './task-order.ts'
import { IconButton, Tile, TileHead } from './tile.tsx'

/** Which editor, if any, is open. Shared with every other list on the board. */
type Mode = EditorState

/** The transition, bound to a list's ids so an edit of a vanished row closes. */
function useEditor(ids: readonly string[]): [Mode, (action: EditorAction) => void] {
  return useReducer(
    (state: Mode, action: EditorAction) => editor(state, action, ids),
    IDLE,
  )
}

/** Fields a media entry exposes. */
const MEDIA_FIELDS: readonly FieldSpec[] = [
  {
    name: 'kind',
    label: '类型',
    kind: 'select',
    defaultValue: 'film',
    options: [{ value: 'film', label: '电影' }, { value: 'book', label: '书' }],
  },
  { name: 'title', label: '名称', kind: 'text' },
  {
    name: 'status',
    label: '状态',
    kind: 'select',
    defaultValue: 'active',
    options: [
      { value: 'active', label: '在看/在读' },
      { value: 'done', label: '完成' },
      { value: 'dropped', label: '弃' },
    ],
  },
  { name: 'rating', label: '评分', kind: 'number', min: 1, max: 5, optional: true, placeholder: '1-5' },
  // The same field focus mode edits at length, so the board must not be the
  // place a long note gets flattened into one line.
  { name: 'notes', label: '备注', kind: 'textarea', optional: true, wide: true },
]

/** Fields a task exposes (progress is flattened for the form). */
const TASK_FIELDS: readonly FieldSpec[] = [
  { name: 'title', label: '事项', kind: 'text' },
  { name: 'category', label: '分类', kind: 'text', optional: true, placeholder: '课程名等' },
  { name: 'due', label: '截止', kind: 'date', optional: true },
  { name: 'current', label: '当前', kind: 'number', min: 0, optional: true },
  { name: 'total', label: '目标量', kind: 'number', min: 1, optional: true },
  { name: 'checkpoints', label: '检查点', kind: 'textarea', optional: true, placeholder: '每行一个：第一章@10', wide: true },
  { name: 'notes', label: '备注', kind: 'textarea', optional: true, wide: true },
]

/**
 * Task fields for a *new* task, whose deadline starts at this week's end.
 *
 * Most homework and chores are due by the weekend, so that is the value worth
 * pre-filling; it stays an ordinary optional date field, freely changed or
 * cleared. Built per render — a module-level default would freeze at import.
 */
function newTaskFields(today: string): readonly FieldSpec[] {
  const weekend = weekEndKey(today)
  return TASK_FIELDS.map(field => (field.name === 'due' ? { ...field, defaultValue: weekend } : field))
}

/** Display text for a media status; the label table lives in `format.ts`. */

/** A payload for a new media entry; empty optional fields are omitted. */
function mediaInput(payload: Record<string, unknown>): MediaInput {
  return {
    kind: payload.kind === 'book' ? 'book' : 'film',
    title: String(payload.title ?? ''),
    ...(typeof payload.status === 'string' ? { status: payload.status as NonNullable<MediaInput['status']> } : {}),
    ...(typeof payload.rating === 'number' ? { rating: payload.rating } : {}),
    ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
  }
}

/** A media patch; a field the record had and the form emptied is cleared. */
function mediaPatch(payload: Record<string, unknown>, original: MediaEntry): MediaPatch {
  const patch: Record<string, unknown> = {}
  if (typeof payload.kind === 'string') patch.kind = payload.kind
  if (typeof payload.title === 'string') patch.title = payload.title
  if (typeof payload.status === 'string') patch.status = payload.status
  if (typeof payload.rating === 'number') patch.rating = payload.rating
  else if (original.rating !== undefined) patch.rating = null
  if (typeof payload.notes === 'string') patch.notes = payload.notes
  else if (original.notes !== undefined) patch.notes = null
  return patch as MediaPatch
}

/**
 * The one rule the task form must check across fields: checkpoints point into
 * the progress axis, so a target amount must be there for them to sit inside,
 * and none may sit past it. Clearing the total while keeping checkpoints is
 * the same fault — hence the payload's own `total`, never the record's.
 */
function taskFormProblem(payload: Record<string, unknown>): string | undefined {
  const text = typeof payload.checkpoints === 'string' ? payload.checkpoints : ''
  if (text.trim() === '') return undefined
  const { list, problem } = parseCheckpoints(text)
  if (problem !== undefined) return problem
  if (typeof payload.total !== 'number') return '检查点需要目标量'
  const total = payload.total
  const beyond = list.find(checkpoint => checkpoint.at > total)
  return beyond === undefined
    ? undefined
    : `检查点「${beyond.label}」的位置 ${beyond.at} 超过目标量 ${total}`
}

/** A payload for a new task; empty optional fields are omitted. */
function taskInput(payload: Record<string, unknown>): TaskInput {
  const progress: { current?: number; total?: number } = {}
  if (typeof payload.current === 'number') progress.current = payload.current
  if (typeof payload.total === 'number') progress.total = payload.total
  const checkpoints = parseCheckpoints(
    typeof payload.checkpoints === 'string' ? payload.checkpoints : '',
  ).list
  return {
    title: String(payload.title ?? ''),
    ...(typeof payload.category === 'string' ? { category: payload.category } : {}),
    ...(typeof payload.due === 'string' ? { due: payload.due } : {}),
    ...(typeof payload.notes === 'string' ? { notes: payload.notes } : {}),
    ...(Object.keys(progress).length === 0 ? {} : { progress }),
    ...(checkpoints.length === 0 ? {} : { checkpoints }),
  }
}

/** A task patch; emptied fields the record had are cleared, progress merges. */
function taskPatch(payload: Record<string, unknown>, original: TaskEntry): TaskPatch {
  const patch: Record<string, unknown> = {}
  if (typeof payload.title === 'string') patch.title = payload.title
  for (const key of ['category', 'due', 'notes'] as const) {
    const value = payload[key]
    if (typeof value === 'string') patch[key] = value
    else if (original[key] !== undefined) patch[key] = null
  }
  const progress: Record<string, unknown> = {}
  if (typeof payload.current === 'number') progress.current = payload.current
  if (typeof payload.total === 'number') progress.total = payload.total
  else if (original.progress.total !== undefined) progress.total = null
  if (Object.keys(progress).length > 0) patch.progress = progress
  // The field is always in the task form, so an emptied textarea *is* the
  // "remove them all" — an empty list is sent, not an absent key.
  patch.checkpoints = parseCheckpoints(
    typeof payload.checkpoints === 'string' ? payload.checkpoints : '',
  ).list
  return patch as TaskPatch
}

/** Props for the media tile. */
export interface MediaTileProps {
  readonly media: readonly MediaEntry[]
  readonly busy: boolean
  readonly onAdd: (input: MediaInput) => void
  readonly onPatch: (id: string, patch: MediaPatch) => void
  readonly onRemove: (id: string) => void
  /** Opens one entry in focus mode. */
  readonly onFocus: (entry: MediaEntry) => void
}

/**
 * A media entry whose watching is over: finished or abandoned. Both are
 * answered business, so both fold out of the live list.
 *
 * Purely a display derivation — nothing is stored or moved, and the host knows
 * nothing about it (docs/adr/0002-derived-state-not-stored.md).
 */
function isSettled(entry: MediaEntry): boolean {
  return entry.status === 'done' || entry.status === 'dropped'
}

/** What has been watched and read: a log, written after the fact. */
export function MediaTile({ media, busy, onAdd, onPatch, onRemove, onFocus }: MediaTileProps): JSX.Element {
  const [mode, dispatch] = useEditor(media.map(entry => entry.id))
  const live = media.filter(entry => !isSettled(entry))
  const settled = media.filter(isSettled)
  const active = live.length

  /** One entry, as the open editor or as its row — the same in either list. */
  const renderEntry = (entry: MediaEntry): JSX.Element => (isEditing(mode, entry.id)
    ? (
      <FieldForm
        key={entry.id}
        fields={MEDIA_FIELDS}
        initial={{
          kind: entry.kind,
          title: entry.title,
          status: entry.status,
          rating: entry.rating,
          notes: entry.notes,
        }}
        submitLabel="保存"
        busy={busy}
        onSubmit={(payload) => {
          onPatch(entry.id, mediaPatch(payload, entry))
          dispatch({ kind: 'close' })
        }}
        onCancel={() => dispatch({ kind: 'close' })}
      />
    )
    : (
      <div className="pt-list-row" key={entry.id}>
        <span className="pt-list-text pt-row-open" title="进入专注模式" onClick={() => onFocus(entry)}>
          <span className={entry.status === 'done' ? 'pt-badge pt-badge-ok' : 'pt-badge'}>
            {entry.kind === 'film' ? '影' : '书'}
          </span>
          {' '}
          {entry.title}
          {entry.rating === undefined ? null : <span className="pt-muted"> ★{entry.rating}</span>}
          <span className="pt-muted"> · {mediaStatusLabel(entry.status)}</span>
        </span>
        <IconButton label="专注" disabled={busy} onClick={() => onFocus(entry)}>⤢</IconButton>
        <IconButton label="编辑" disabled={busy} onClick={() => dispatch({ kind: 'edit', id: entry.id })}>✎</IconButton>
        <IconButton label="删除" disabled={busy} onClick={() => onRemove(entry.id)}>×</IconButton>
      </div>
    ))

  return (
    <Tile span={2}>
      <TileHead title="影视 / 书籍" meta={media.length === 0 ? '空' : `在列 ${active}`}>
        <IconButton label="新增记录" disabled={busy} onClick={() => dispatch({ kind: 'open-add' })}>＋</IconButton>
      </TileHead>

      {media.length === 0 && mode.kind === 'idle'
        ? <span className="pt-muted">看完一部、读完一本，随时补记</span>
        : null}
      {media.length > 0 && live.length === 0 && mode.kind === 'idle'
        ? <span className="pt-muted">没有在看或在读的记录</span>
        : null}

      {live.map(renderEntry)}

      {settled.length === 0 ? null : (
        <details className="pt-archive">
          <summary title="已完成或已放弃的记录">归档 {settled.length} 条</summary>
          {settled.map(renderEntry)}
        </details>
      )}

      {isAdding(mode)
        ? (
          <FieldForm
            fields={MEDIA_FIELDS}
            submitLabel="记下"
            busy={busy}
            onSubmit={(payload) => {
              onAdd(mediaInput(payload))
              dispatch({ kind: 'close' })
            }}
            onCancel={() => dispatch({ kind: 'close' })}
          />
        )
        : null}
    </Tile>
  )
}

/** Props for the task tile. */
export interface TaskTileProps {
  readonly tasks: readonly TaskEntry[]
  /** The current habit day: what "this week's end" is measured from. */
  readonly today: string
  readonly busy: boolean
  readonly onAdd: (input: TaskInput) => void
  readonly onPatch: (id: string, patch: TaskPatch) => void
  readonly onRemove: (id: string) => void
  /** Opens one entry in focus mode. */
  readonly onFocus: (entry: TaskEntry) => void
}

/** The deadline as the row shows it: "今天" when it is, else `MM-DD`. */
function dueText(due: string, today: string): string {
  return due === today ? '今天' : due.slice(5)
}

/**
 * The task's completion as a 0..1 fraction.
 *
 * A task without a target amount is a plain checkbox: it has no fraction to
 * show, so it reads 0 or 1. A target of 0 cannot be divided by either, and is
 * treated the same way as no target at all.
 */
function ratioOf(entry: TaskEntry): number {
  const { current, total } = entry.progress
  if (total === undefined || total <= 0) return current > 0 ? 1 : 0
  return Math.max(0, Math.min(1, current / total))
}

/** Where along the bar a pointer sits, as a 0..1 fraction. */
function ratioFromPointer(event: ReactPointerEvent<HTMLElement>, element: HTMLElement): number {
  const box = element.getBoundingClientRect()
  if (box.width <= 0) return 0
  return Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
}

/** The bar's value in whole units — what a drag or a key press writes. */
function barValue(entry: TaskEntry, ratio: number): number {
  const total = entry.progress.total
  if (total === undefined || total <= 0) return ratio > 0 ? 1 : 0
  return Math.max(0, Math.min(total, Math.round(ratio * total)))
}

/** What the bar's tooltip reads. */
function barTitle(entry: TaskEntry, dragging: boolean): string {
  const { current, total } = entry.progress
  const quantized = total !== undefined && total > 0
  const state = entry.state === 'done'
    ? '已完成'
    : entry.overdue ? '逾期未完成' : current > 0 ? '进行中' : '未完成'
  const parts = [
    quantized
      ? `${state} ${percentOf(ratioOf(entry))}%（${fractionText(current)}/${fractionText(total)}）`
      : state,
  ]
  if (entry.completedAt !== undefined) {
    const date = entry.completedAt.slice(0, 10)
    parts.push(`完成于 ${date.slice(5)} ${timeOf(entry.completedAt)}`)
  }
  for (const checkpoint of [...entry.checkpoints].sort((a, b) => a.at - b.at)) {
    parts.push(checkpoint.reachedAt === undefined
      ? `${checkpoint.label}@${checkpoint.at} 未到`
      : `${checkpoint.label}@${checkpoint.at} 已到 ${checkpoint.reachedAt.slice(5, 10)} ${timeOf(checkpoint.reachedAt)}`)
  }
  parts.push(dragging ? '松开写入进度' : quantized ? '拖动或 ←/→ 调整进度' : '点击切换完成，←/→ 也可')
  return parts.join(' · ')
}

/**
 * One task, on two lines.
 *
 * The first line is what the task *is* — title, course, deadline — and the
 * second is what can be done to it: a bar that says how far along it is, plus
 * edit and delete. The state is deliberately not spelled out as a word: a
 * finished task is a full bar with a ✓ on it, and a late one is red, so the
 * thing you would read is the same thing you would act on.
 *
 * Dragging writes once, on release. Every move would otherwise be an API call,
 * and the host answers each one with a whole slice; the local `drag` value is
 * the preview — the thumb and the reading beside the bar follow it live — and
 * `progress.current` stays the accepted truth until then.
 */
function TaskRow({ entry, today, busy, onPatch, onEdit, onRemove, onFocus }: {
  readonly entry: TaskEntry
  readonly today: string
  readonly busy: boolean
  readonly onPatch: (patch: TaskPatch) => void
  readonly onEdit: () => void
  readonly onRemove: () => void
  readonly onFocus: () => void
}): JSX.Element {
  const [drag, setDrag] = useState<number | null>(null)
  const total = entry.progress.total
  const quantized = total !== undefined && total > 0
  const ratio = drag ?? ratioOf(entry)
  // While dragging, the reading follows the thumb (what it will become), not
  // `progress.current` (what the host last accepted).
  const shown = drag === null ? entry.progress.current : barValue(entry, drag)
  const commit = (next: number): void => onPatch({ progress: { current: next } })
  // Stages in axis order; "reached" follows the live reading, so a thumb
  // sliding past a stage lights it before the write ever happens.
  const stages = [...entry.checkpoints].sort((a, b) => a.at - b.at)
  // The count's box: wide enough for the widest reading this task can print
  // (`10/10` and up), so a drag never re-layouts the row under the pointer.
  const countWidth = Math.max(5, fractionText(total ?? 0).length * 2 + 1)
  const barClass = [
    'pt-task-bar',
    quantized ? '' : 'pt-task-bar-plain',
    drag === null ? '' : 'pt-task-bar-active',
  ].filter(Boolean).join(' ')

  return (
    <div className={entry.overdue && entry.state !== 'done' ? 'pt-task pt-task-late' : 'pt-task'}>
      <div className="pt-task-head">
        <span className="pt-task-title pt-row-open" title="进入专注模式" onClick={onFocus}>{entry.title}</span>
        {entry.category === undefined ? null : <span className="pt-muted">({entry.category})</span>}
        {entry.due === undefined
          ? null
          : (
            <span className={`pt-task-due pt-due-${dueLevelOf(entry.due, today)}`}>
              截止于{dueText(entry.due, today)}
            </span>
          )}
      </div>

      <div className="pt-task-foot">
        <button
          type="button"
          className={barClass}
          disabled={busy}
          title={barTitle(entry, drag !== null)}
          aria-label={`${entry.title} 进度`}
          aria-valuemin={0}
          aria-valuemax={quantized ? total : 1}
          aria-valuenow={shown}
          onPointerDown={(event) => {
            if (!quantized) return
            const box = event.currentTarget
            box.setPointerCapture(event.pointerId)
            setDrag(ratioFromPointer(event, box))
          }}
          onPointerMove={(event) => {
            if (drag === null || !quantized) return
            setDrag(ratioFromPointer(event, event.currentTarget))
          }}
          onPointerUp={(event) => {
            if (drag === null || !quantized) return
            const next = barValue(entry, ratioFromPointer(event, event.currentTarget))
            setDrag(null)
            if (next !== entry.progress.current) commit(next)
          }}
          onPointerCancel={() => setDrag(null)}
          onClick={() => {
            // A drag already wrote on release, and a bar on the pointer path
            // never toggles; this is the plain click and the keyboard.
            if (quantized || drag !== null) return
            commit(entry.state === 'done' ? 0 : 1)
          }}
          onKeyDown={(event) => {
            const max = quantized ? total : 1
            if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault()
              commit(Math.min(max, entry.progress.current + 1))
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault()
              commit(Math.max(0, entry.progress.current - 1))
            } else if (event.key === 'Home') {
              event.preventDefault()
              commit(0)
            } else if (event.key === 'End') {
              event.preventDefault()
              commit(max)
            }
          }}
        >
          <span
            className={entry.overdue && entry.state !== 'done' ? 'pt-task-fill pt-task-fill-late' : 'pt-task-fill'}
            style={{ width: `${percentOf(ratio)}%` }}
          />
          {quantized
            ? <span className="pt-task-thumb" style={{ left: `${percentOf(ratio)}%` }} />
            : null}
          {quantized
            ? stages.map(stage => (
              <span
                key={stage.id}
                className={shown >= stage.at ? 'pt-task-tick pt-task-tick-ok' : 'pt-task-tick'}
                style={{ left: `${percentOf(Math.min(1, stage.at / (total ?? 1)))}%` }}
              />
            ))
            : null}
        </button>
        {quantized
          ? (
            <span
              className={drag === null ? 'pt-task-count' : 'pt-task-count pt-task-count-live'}
              title="当前 / 目标量"
              style={{ minWidth: `${countWidth}ch` }}
            >
              {fractionText(shown)}/{fractionText(total)}
            </span>
          )
          : null}
        {entry.state === 'done' ? <span className="pt-task-ok" title="已完成">✓</span> : null}
        <IconButton label="专注" disabled={busy} onClick={onFocus}>⤢</IconButton>
        <IconButton label="编辑" disabled={busy} onClick={onEdit}>✎</IconButton>
        <IconButton label="删除" disabled={busy} onClick={onRemove}>×</IconButton>
      </div>
    </div>
  )
}

/**
 * A finished task whose deadline has passed: answered business, ready to fold
 * out of the live list.
 *
 * Purely a display derivation — nothing is stored or moved, and the host knows
 * nothing about it (docs/adr/0002-derived-state-not-stored.md). A task merely
 * finished, or merely past due, stays in the live list: one still celebrates
 * its own due date, the other still wants attention.
 */
function isArchived(task: TaskEntry, today: string): boolean {
  return task.state === 'done' && task.due !== undefined && task.due < today
}

/**
 * Tasks and homework: due soonest first, with the derived state shown. The
 * order itself belongs to `./task-order.ts`, because the daily report reads the
 * registry in it too.
 */
export function TaskTile({ tasks, today, busy, onAdd, onPatch, onRemove, onFocus }: TaskTileProps): JSX.Element {
  const [mode, dispatch] = useEditor(tasks.map(task => task.id))
  const open = tasks.filter(task => task.state !== 'done').length
  const overdue = tasks.filter(task => task.overdue).length
  const dueToday = tasks.filter(task => task.due === today).length
  const ordered = [...tasks].sort(byDeadline)
  const live = ordered.filter(task => !isArchived(task, today))
  const archived = ordered.filter(task => isArchived(task, today))

  /** One task, as the open editor or as its row — the same in either list. */
  const renderTask = (task: TaskEntry): JSX.Element => (isEditing(mode, task.id)
    ? (
      <FieldForm
        key={task.id}
        fields={TASK_FIELDS}
        initial={{
          title: task.title,
          category: task.category,
          due: task.due,
          current: task.progress.current,
          total: task.progress.total,
          checkpoints: formatCheckpoints(task.checkpoints),
          notes: task.notes,
        }}
        validate={taskFormProblem}
        submitLabel="保存"
        busy={busy}
        onSubmit={(payload) => {
          onPatch(task.id, taskPatch(payload, task))
          dispatch({ kind: 'close' })
        }}
        onCancel={() => dispatch({ kind: 'close' })}
      />
    )
    : (
      <TaskRow
        key={task.id}
        entry={task}
        today={today}
        busy={busy}
        onPatch={patch => onPatch(task.id, patch)}
        onEdit={() => dispatch({ kind: 'edit', id: task.id })}
        onRemove={() => onRemove(task.id)}
        onFocus={() => onFocus(task)}
      />
    ))

  return (
    <Tile span={2}>
      <TileHead
        title="任务 / 作业"
        meta={`未完成 ${open}${dueToday === 0 ? '' : ` · 今日到期 ${dueToday}`}${overdue === 0 ? '' : ` · 逾期 ${overdue}`}`}
      >
        <IconButton label="新建任务" disabled={busy} onClick={() => dispatch({ kind: 'open-add' })}>＋</IconButton>
      </TileHead>

      {tasks.length === 0 && mode.kind === 'idle' ? <span className="pt-muted">还没有任务</span> : null}
      {tasks.length > 0 && live.length === 0 && mode.kind === 'idle'
        ? <span className="pt-muted">没有进行中的任务</span>
        : null}

      {live.map(renderTask)}

      {archived.length === 0 ? null : (
        <details className="pt-archive">
          <summary title="过了截止日且已完成的任务">归档 {archived.length} 条</summary>
          {archived.map(renderTask)}
        </details>
      )}

      {isAdding(mode)
        ? (
          <FieldForm
            fields={newTaskFields(today)}
            validate={taskFormProblem}
            submitLabel="新建"
            busy={busy}
            onSubmit={(payload) => {
              onAdd(taskInput(payload))
              dispatch({ kind: 'close' })
            }}
            onCancel={() => dispatch({ kind: 'close' })}
          />
        )
        : null}
    </Tile>
  )
}
