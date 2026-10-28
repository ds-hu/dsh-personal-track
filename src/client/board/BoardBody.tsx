/**
 * The habit board's body: the right-sidebar tab's React component.
 *
 * It owns no authoritative state — every read and every mutation answers with a
 * complete slice from the host, and this component renders the latest one
 * (docs/adr/0002-derived-state-not-stored.md). Commands arrive through the slot
 * registration's injection face, so the component never sees `ctx`.
 *
 * Layout: a progress strip, the date navigator, then a two column grid of
 * tiles grouped by area. Every group is always shown — the board is short
 * enough to read top to bottom, and a hidden group is a habit you forget.
 */
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  type HabitClient,
  type MediaInput,
  type MediaPatch,
  type SessionKind,
  type TaskInput,
  type TaskPatch,
} from '../api.ts'
import type { ClockView, StateView, VocabProgress } from '../types.ts'
import { CheckTile, LaundryTile, MealBoard } from './cards.tsx'
import { Chip } from './Chip.tsx'
import { DateNav } from './DateNav.tsx'
import { EquipmentCard, FreeCard, PlankCard, PullupCard, RopeCard, RunTile } from './fitness.tsx'
import type { RegistryEntry } from './focus.ts'
import { fractionText, messageOf } from './format.ts'
import { MediaTile, TaskTile } from './registry.tsx'
import { dayReport } from './report.ts'
import { DuolingoCard, VocabCard } from './study.tsx'
import { GroupHeader, ProgressRing, Tile, TileHead } from './tile.tsx'

/** Shown until the first slice arrives. */
const EMPTY_VOCAB: VocabProgress = {
  doneNew: 0, doneReview: 0, targetNew: 0, targetReview: 0,
  minutes: 0, ratio: 0, surplusNew: 0, surplusReview: 0, met: false,
}

/**
 * The board's own glyph: the completion ring it is built around, with the check
 * inside.
 *
 * Hand-drawn inline SVG, the way `StatsIcon` is, and for the same reason: it
 * carries no dependency. It eats `currentColor` only, so neither theme needs a
 * colour of its own. `@deepseek-ai/dsh-client-ui-primitives` would have offered
 * a ready-made outline glyph, but that package cannot load in Node (it wants
 * `clsx`, which it does not declare, and it imports CSS modules), and
 * `scripts/verify-client.mjs` really does materialize this bundle in Node.
 */
export function BoardIcon({ size = 16, className }: {
  readonly size?: number
  readonly className?: string
}): JSX.Element {
  // Same convention as the board's ProgressRing: rotate -90 so the dash starts at
  // twelve o'clock and runs clockwise; r = 8.5 gives a 53.41 circumference, and
  // `40.1 13.3` leaves the last quarter open — a ring three-quarters done.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.5" opacity={0.3} />
      <circle cx="12" cy="12" r="8.5" strokeDasharray="40.1 13.3" transform="rotate(-90 12 12)" />
      <path d="M8.6 12.3l2.4 2.4 4.4-4.9" />
    </svg>
  )
}

/** Props handed in by the slot registration's injection face. */
export interface BoardBodyProps {
  readonly client: HabitClient
  /** Switches the panel to its statistics view. */
  readonly onShowStats: () => void
  /** Opens one registry entry in focus mode. */
  readonly onOpenFocus: (entry: RegistryEntry) => void
  /**
   * Bumped when another surface wrote state, so the board re-reads its day.
   *
   * The board holds its own slice — it reads the day being *shown*, which is not
   * always the panel's today — so nothing else can refresh it. Focus mode is the
   * writer that matters: without this token its progress and notes edits never
   * reach this component, and the bars stay on the value from before the overlay
   * was opened.
   */
  readonly refreshToken: number
  /**
   * Told every time the board adopts a slice.
   *
   * The registry lists (`tasks`, `media`) are global, so the panel can take them
   * from any read the board makes; that is how a card pinned in the focus column
   * notices that its task was completed on the board.
   */
  readonly onStateRead: (state: StateView) => void
}

/** Render the board. */
export function BoardBody({
  client, onShowStats, onOpenFocus, refreshToken, onStateRead,
}: BoardBodyProps): JSX.Element {
  const [clock, setClock] = useState<ClockView | null>(null)
  const [date, setDate] = useState<string | null>(null)
  const [state, setState] = useState<StateView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef(0)
  /**
   * The reads issued so far, so an older answer cannot overwrite a newer one.
   *
   * Two things read this day now — the date navigator and the panel's `refreshToken`
   * — and a read is a round trip; the answer that arrives last is not
   * necessarily the one asked for last.
   */
  const reads = useRef(0)
  /** The token this board has already honoured; a remount starts level. */
  const seenToken = useRef(refreshToken)

  const report = useCallback((cause: unknown) => {
    setError(messageOf(cause))
  }, [])

  /** Adopt one slice: it becomes what is drawn, and the panel hears about it. */
  const adopt = useCallback((next: StateView) => {
    setState(next)
    setError(null)
    onStateRead(next)
  }, [onStateRead])

  const loadState = useCallback(async (target: string) => {
    const seq = ++reads.current
    try {
      const next = await client.state(target)
      // Superseded: a later read (or a mutation's own answer) is on its way, and
      // it knows more than this one does.
      if (seq !== reads.current) return
      adopt(next)
    } catch (cause) {
      if (seq === reads.current) report(cause)
    }
  }, [adopt, client, report])

  const loadClock = useCallback(async (): Promise<ClockView | null> => {
    try {
      const value = await client.clock()
      setClock(value)
      return value
    } catch (cause) {
      report(cause)
      return null
    }
  }, [client, report])

  // First mount: ask the host what today is, then load that day.
  useEffect(() => {
    let alive = true
    void loadClock().then((value) => {
      if (!alive || value === null) return
      setDate(value.today)
      return loadState(value.today)
    })
    return () => {
      alive = false
    }
  }, [loadClock, loadState])

  // Coming back to the tab may cross the habit-day boundary or see new data.
  useEffect(() => {
    if (date === null) return
    const onFocus = (): void => {
      void loadClock()
      void loadState(date)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [date, loadClock, loadState])

  // Another surface wrote state: focus mode's overlay covered this board, so its
  // writes are invisible here until the shown day is read again — the task's bar
  // and the cell that bar fills both hang off this slice.
  useEffect(() => {
    if (refreshToken === seenToken.current) return
    seenToken.current = refreshToken
    if (date !== null) void loadState(date)
  }, [date, loadState, refreshToken])

  // The copy confirmation is a flash, not a state: never let its timer outlive
  // the tab.
  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  /** Run one mutation and adopt the slice it answers with. */
  const act = useCallback(async (action: () => Promise<StateView>) => {
    setBusy(true)
    try {
      const next = await action()
      // This answer is newer than any read still in flight, so it also retires
      // them: the mutation's own slice already includes what they were asking.
      reads.current += 1
      adopt(next)
    } catch (cause) {
      report(cause)
    } finally {
      setBusy(false)
    }
  }, [adopt, report])

  if (date === null || clock === null) {
    return <div className="pt-board"><div className="pt-muted">加载中…</div></div>
  }

  const day = state?.day
  const record = day?.day ?? null
  const pending = state?.stock.pending ?? 0

  const goTo = (target: string): void => {
    setDate(target)
    void loadState(target)
  }

  /** The handlers every session list shares, bound to one habit kind. */
  const sessionHandlers = (kind: SessionKind) => ({
    busy,
    onAdd: (payload: Record<string, unknown>) => void act(() => client.addSession(date, kind, payload)),
    onPatch: (id: string, payload: Record<string, unknown>) =>
      void act(() => client.patchSession(date, kind, id, payload)),
    onRemove: (id: string) => void act(() => client.removeSession(date, kind, id)),
  })
  const vocabSessions = sessionHandlers('vocab')

  /**
   * Registry writes answer with the slice of the day they were sent — the board
   * passes the day it is showing as the **viewpoint** — so there is nothing to
   * re-read.
   *
   * A host older than this bundle answers with the list alone (the two halves
   * update separately, and a browser bundle hot reloads while the host needs a
   * `dsh` restart). Then there is no slice to adopt and the read happens here:
   * the same value, one round trip later.
   */
  const registryAct = (action: () => Promise<StateView>): void => void act(async () => {
    const answer = await action()
    return answer.day === undefined ? await client.state(date) : answer
  })

  /** Show the copy confirmation for a moment, restarting the timer if due. */
  const flashCopied = (): void => {
    setCopied(true)
    window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  /** Copy the shown day as plain text, for pasting somewhere else. */
  const copyReport = async (): Promise<void> => {
    if (state === null) return
    const text = dayReport(state, clock)
    try {
      await navigator.clipboard.writeText(text)
      flashCopied()
    } catch {
      // The clipboard API wants a secure context and a grant; a hidden
      // textarea still lands the copy where neither is available.
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.append(area)
      area.select()
      const landed = document.execCommand('copy')
      area.remove()
      if (landed) flashCopied()
    }
  }

  return (
    <div className="pt-board">
      <div className="pt-strip">
        <ProgressRing
          ratio={day === undefined || day.progress.total === 0 ? 0 : day.progress.done / day.progress.total}
          label={`${fractionText(day?.progress.done ?? 0)}/${day?.progress.total ?? 8}`}
          sub="今日"
        />
        {day === undefined ? null : <Chip cells={day.cells} progress={day.progress} />}
        <span className="pt-grow" />
        <button type="button" className="pt-ghost" onClick={onShowStats} title="切到统计视图">统计</button>
      </div>

      <DateNav date={date} today={clock.today} night={clock.nightTail} onChange={goTo} />
      {error === null ? null : <div className="pt-error">{error}</div>}

      <div className="pt-grid">
        <GroupHeader label="日常" />
        <CheckTile
          label="洗漱"
          times={record?.washes.times ?? []}
          max={2}
          busy={busy}
          onCheck={() => void act(() => client.check(date, 'wash'))}
          onEdit={(index, time) => void act(() => client.editCheck(date, 'wash', index, time))}
          onRemove={index => void act(() => client.uncheck(date, 'wash', index))}
        />
        <CheckTile
          label="洗澡"
          times={record?.shower.at == null ? [] : [record.shower.at]}
          max={1}
          busy={busy}
          onCheck={() => void act(() => client.check(date, 'shower'))}
          onEdit={(_index, time) => void act(() => client.editCheck(date, 'shower', undefined, time))}
          onRemove={() => void act(() => client.uncheck(date, 'shower'))}
        />
        <LaundryTile
          pending={pending}
          busy={busy}
          onDelta={delta => void act(() => client.setStock(Math.max(0, pending + delta), { date }))}
          onWash={(pieces, time) => void act(() => client.wash(date, pieces, time))}
          onSet={value => void act(() => client.setStock(value, { date }))}
        />

        <GroupHeader label="饮食" />
        <MealBoard
          meals={record?.meals ?? {}}
          busy={busy}
          onRecord={(slot, options) => void act(() => client.setMeal(date, slot, options))}
          onClear={slot => void act(() => client.clearMeal(date, slot))}
        />

        <GroupHeader label="学习" />
        <VocabCard
          target={day?.target ?? clock.config.defaultVocabTarget}
          progress={day?.vocab ?? EMPTY_VOCAB}
          sessions={record?.vocab?.sessions ?? []}
          busy={busy}
          onTarget={target => void act(() => client.setVocabTarget(date, target))}
          onAdd={vocabSessions.onAdd}
          onPatch={vocabSessions.onPatch}
          onRemove={vocabSessions.onRemove}
        />
        <DuolingoCard lessons={record?.duolingo ?? []} {...sessionHandlers('duolingo')} />

        <GroupHeader label="健身" />
        <RunTile
          run={record?.run ?? null}
          defaultMinutes={clock.config.defaultRunMinutes}
          busy={busy}
          onSet={payload => void act(() => client.setRun(date, {
            distanceKm: Number(payload.distanceKm),
            ...(payload.minutes === undefined ? {} : { minutes: Number(payload.minutes) }),
            ...(payload.avgHr === undefined ? {} : { avgHr: Number(payload.avgHr) }),
            ...(typeof payload.time === 'string' ? { time: payload.time } : {}),
          }))}
          onClear={() => void act(() => client.clearRun(date))}
        />
        <RopeCard sessions={record?.rope ?? []} {...sessionHandlers('rope')} />
        <PullupCard sessions={record?.pullup ?? []} {...sessionHandlers('pullup')} />
        <PlankCard sessions={record?.plank ?? []} {...sessionHandlers('plank')} />
        <EquipmentCard sessions={record?.equipment ?? []} {...sessionHandlers('equipment')} />
        <FreeCard sessions={record?.free ?? []} {...sessionHandlers('free')} />

        <GroupHeader label="记录" />
        <MediaTile
          media={state?.media ?? []}
          busy={busy}
          onAdd={(input: MediaInput) => registryAct(() => client.addMedia(input, { date }))}
          onPatch={(id, patch: MediaPatch) => registryAct(() => client.patchMedia(id, patch, { date }))}
          onRemove={id => registryAct(() => client.removeMedia(id, { date }))}
          onFocus={onOpenFocus}
        />
        <TaskTile
          tasks={state?.tasks ?? []}
          today={clock.today}
          busy={busy}
          onAdd={(input: TaskInput) => registryAct(() => client.addTask(input, { date }))}
          onPatch={(id, patch: TaskPatch) => registryAct(() => client.patchTask(id, patch, { date }))}
          onRemove={id => registryAct(() => client.removeTask(id, { date }))}
          onFocus={onOpenFocus}
        />

        {record === null ? (
          <Tile span={2}>
            <TileHead title="这一天还没有记录" />
            <div className="pt-tile-foot">
              <span className="pt-muted">从上面任意一项开始打卡即可</span>
            </div>
          </Tile>
        ) : null}
      </div>

      <div className="pt-board-foot">
        <span className="pt-grow" />
        <button
          type="button"
          className="pt-ghost"
          disabled={state === null}
          onClick={() => void copyReport()}
        >{copied ? '已复制 ✓' : '复制纯文本报告'}</button>
      </div>
    </div>
  )
}
