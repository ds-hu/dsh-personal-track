/**
 * Focus mode: one registry entry, full screen, with its own materials.
 *
 * Layout follows the reviewed demo: a narrow left column (name, meta, focus
 * timer, notes), a slim toolbar across the top right (progress plus the two
 * controls), and the material stream below it.
 *
 * Two decisions worth stating where they bind:
 *
 * - **No portal.** The overlay is a `position: fixed` element rendered in
 *   place. `createPortal` would need `react-dom` in a bundle whose runtime
 *   dependencies come from a frozen platform table, and the case a portal
 *   exists to solve — an ancestor that traps a fixed element — is already
 *   covered by the primary path: a fullscreen element renders in the top layer,
 *   where no ancestor can clip or offset it.
 * - **Fullscreen is requested, never required.** A denied request (browser
 *   policy, a gesture it does not trust) leaves the same overlay on screen, so
 *   the mode works either way.
 */
import { useCallback, useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import type { HabitClient, MediaPatch, TaskPatch } from '../api.ts'
import { MAX_IMAGE_BYTES } from '../../shared/route.ts'
import type { Material, MediaEntry, TaskEntry } from '../types.ts'
import { dueLevelOf, fractionText, mediaStatusLabel, messageOf, percentOf } from './format.ts'
import { clockLabel, formatDuration, nowLabel, openSession, type Pinned, type RegistryEntry } from './focus.ts'
import { Markdown } from './Markdown.tsx'
import { IconButton } from './tile.tsx'

/** How long the notes and Markdown editors wait before writing. */
const SAVE_DELAY_MS = 800

/** Suggested text for a freshly added block, so the box is never bare. */
const NEW_BLOCK = '## 新文本块'

/** Props for the overlay. */
export interface FocusOverlayProps {
  readonly client: HabitClient
  readonly target: Pinned
  /** The entry as the panel last saw it; the overlay keeps its own copy after. */
  readonly entry: RegistryEntry
  /** Called once, with the entry as last written, when the mode is left. */
  readonly onClose: (entry: RegistryEntry) => void
}

/** Read one image file into the wire's shape, or explain why it cannot go. */
function imageInputOf(file: File): Promise<{ mime: string; data: string; name: string }> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error(`「${file.name}」超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB，已拒绝`))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`「${file.name}」读取失败`))
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      // A data URL is `data:<mime>;base64,<payload>`; both halves are needed,
      // and a file the browser could not type is refused rather than guessed at.
      const comma = url.indexOf(',')
      const header = url.slice(0, comma)
      const mime = /^data:([^;,]+)/.exec(header)?.[1]
      if (comma < 0 || mime === undefined) {
        reject(new Error(`「${file.name}」不是可识别的图片`))
        return
      }
      resolve({ mime, data: url.slice(comma + 1), name: file.name })
    }
    reader.readAsDataURL(file)
  })
}

/** Whatever the pointer's x means along a bar. */
function ratioFromPointer(event: ReactPointerEvent<HTMLElement>, element: HTMLElement): number {
  const box = element.getBoundingClientRect()
  if (box.width <= 0) return 0
  return Math.max(0, Math.min(1, (event.clientX - box.left) / box.width))
}

/** Render one entry in focus mode. */
export function FocusOverlay({ client, target, entry: initial, onClose }: FocusOverlayProps): JSX.Element {
  const [entry, setEntry] = useState<RegistryEntry>(initial)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({})
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set())
  const [zoomed, setZoomed] = useState<string | null>(null)
  const [bar, setBar] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const root = useRef<HTMLDivElement | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)
  const notesTimer = useRef(0)
  const blockTimers = useRef(new Map<string, number>())
  const closed = useRef(false)

  const isTask = target.kind === 'task'
  const task = isTask ? entry as TaskEntry : null
  const media = isTask ? null : entry as MediaEntry
  /** The habit day the overlay is showing, for deadline urgency. */
  const today = clockDate(nowMs)

  const report = useCallback((cause: unknown) => { setError(messageOf(cause)) }, [])

  /** Run one write and adopt the entry it answers with. */
  const run = useCallback(async (
    action: () => Promise<{ readonly entry?: RegistryEntry }>,
  ): Promise<RegistryEntry | null> => {
    setBusy(true)
    try {
      const result = await action()
      const next = result.entry
      if (next === undefined) return null
      setEntry(next)
      setError(null)
      return next
    } catch (cause) {
      report(cause)
      return null
    } finally {
      setBusy(false)
    }
  }, [report])

  /** The notes write for whichever registry this is. */
  const writeNotes = useCallback((text: string): Promise<{ readonly entry?: RegistryEntry }> => (
    isTask
      ? client.patchTask(entry.id, { notes: text } as TaskPatch)
      : client.patchMedia(entry.id, { notes: text } as MediaPatch)
  ), [client, entry.id, isTask])

  // --- the session, the clock, and the way out ---------------------------

  useEffect(() => {
    let alive = true
    void client.startFocus(target.kind, target.id)
      .then((result) => {
        if (!alive) return
        setSessionId(result.sessionId)
        if (result.entry !== undefined) setEntry(result.entry)
        setError(null)
      })
      .catch((cause: unknown) => { if (alive) report(cause) })
    return () => { alive = false }
  }, [client, report, target.id, target.kind])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const onFullscreenChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  /** Leave the mode: close the session, then hand the entry back. */
  const close = useCallback(async (): Promise<void> => {
    if (closed.current) return
    closed.current = true
    window.clearTimeout(notesTimer.current)
    for (const timer of blockTimers.current.values()) window.clearTimeout(timer)
    if (sessionId !== null) {
      try {
        await client.endFocus(target.kind, target.id, sessionId)
      } catch {
        // A session that cannot be closed is dropped by the next start; refusing
        // to leave the mode over it would be worse than losing the tail.
      }
    }
    if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => {})
    onClose(entry)
  }, [client, entry, onClose, sessionId, target.id, target.kind])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Native fullscreen consumes the first Escape; the overlay stays until the
      // next one, so leaving the screen and leaving the mode are separate acts.
      if (document.fullscreenElement !== null) return
      void close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close])

  // --- images: paste, drop, and the picker ------------------------------

  const addImages = useCallback(async (files: readonly File[]): Promise<void> => {
    const images = files.filter(file => file.type.startsWith('image/'))
    if (images.length === 0) {
      if (files.length > 0) setError('拖入的文件里没有图片')
      return
    }
    for (const file of images) {
      try {
        const input = await imageInputOf(file)
        await run(() => client.addImageMaterial(target.kind, target.id, input))
      } catch (cause) {
        report(cause)
      }
    }
  }, [client, report, run, target.id, target.kind])

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const items = event.clipboardData?.items
      if (items === undefined) return
      const files: File[] = []
      for (const item of items) {
        if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (file !== null) files.push(file)
      }
      if (files.length === 0) return
      event.preventDefault()
      void addImages(files)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addImages])

  // --- notes and Markdown: write after a pause ---------------------------

  const onNotesInput = (text: string): void => {
    setNotes(text)
    setSaveState('saving')
    window.clearTimeout(notesTimer.current)
    notesTimer.current = window.setTimeout(() => {
      void run(() => writeNotes(text)).then((next) => {
        if (next !== null) setSaveState('saved')
      }).catch(() => setSaveState('error'))
    }, SAVE_DELAY_MS)
  }

  const writeBlock = useCallback((materialId: string, text: string): void => {
    window.clearTimeout(blockTimers.current.get(materialId))
    const timer = window.setTimeout(() => {
      void run(() => client.patchTextMaterial(target.kind, target.id, materialId, text))
    }, SAVE_DELAY_MS)
    blockTimers.current.set(materialId, timer)
  }, [client, run, target.id, target.kind])

  const addBlock = useCallback(async (): Promise<void> => {
    const next = await run(() => client.addTextMaterial(target.kind, target.id, NEW_BLOCK))
    if (next === null) return
    const added = [...next.materials].reverse().find(material => material.kind === 'md')
    if (added !== undefined) setEditing(current => new Set(current).add(added.id))
  }, [client, run, target.id, target.kind])

  const removeMaterial = useCallback(async (materialId: string): Promise<void> => {
    await run(() => client.removeMaterial(target.kind, target.id, materialId))
  }, [client, run, target.id, target.kind])

  // --- progress (a quantified task only) --------------------------------

  const commitProgress = useCallback((next: number): void => {
    void run(() => client.patchTask(entry.id, { progress: { current: next } } as TaskPatch))
  }, [client, entry.id, run])

  const ratio = task === null
    ? 0
    : task.progress.total === undefined || task.progress.total <= 0
      ? (task.progress.current > 0 ? 1 : 0)
      : Math.max(0, Math.min(1, task.progress.current / task.progress.total))
  const shownRatio = bar ?? ratio
  const quantized = task !== null && task.progress.total !== undefined && task.progress.total > 0
  const total = task?.progress.total ?? 0
  const shownCount = bar === null
    ? task?.progress.current ?? 0
    : Math.max(0, Math.min(total, Math.round(bar * total)))

  const elapsed = (() => {
    if (sessionId === null) return 0
    const open = openSession(entry.focusSessions)
    const started = open === undefined ? Number.NaN : Date.parse(open.startedAt)
    return Number.isFinite(started) ? Math.max(0, (nowMs - started) / 1000) : 0
  })()
  const cumulative = entry.focusSeconds + elapsed

  const meta = isTask && task !== null
    ? [
        task.category === undefined ? null : <span key="category">{task.category}</span>,
        task.due === undefined
          ? null
          : (
            <span key="due" className={`pt-fo-due pt-due-${dueLevelOf(task.due, today)}`}>
              截止于{task.due === today ? '今天' : task.due.slice(5)}
            </span>
          ),
        task.state === 'done' ? <span key="done" className="pt-badge pt-badge-ok">已完成</span> : null,
      ]
    : media === null
      ? []
      : [
          <span key="kind" className={media.status === 'done' ? 'pt-badge pt-badge-ok' : 'pt-badge'}>
            {media.kind === 'film' ? '影' : '书'}
          </span>,
          <span key="status">
            {mediaStatusLabel(media.status)}
            {media.rating === undefined ? '' : ` · ★${media.rating}`}
          </span>,
        ]

  return (
    <div
      className={dropping ? 'pt-fo pt-fo-dropping' : 'pt-fo'}
      ref={root}
      onDragOver={(event) => {
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDropping(false)
        void addImages([...event.dataTransfer.files])
      }}
    >
      <div className="pt-fo-layout">
        <aside className="pt-fo-left">
          <div className="pt-fo-info">
            <div className="pt-fo-name">{entry.title}</div>
            <div className="pt-fo-meta">{meta}</div>
          </div>

          <div className="pt-fo-timers">
            <div
              className="pt-fo-stopwatch"
              tabIndex={0}
              data-tip={`累计专注 ${formatDuration(cumulative)}（含本段）`}
            >{formatDuration(elapsed)}</div>
            <div className="pt-fo-now">{nowLabel(new Date(nowMs))}</div>
          </div>

          <div className="pt-fo-notes">
            <div className="pt-fo-notes-head">
              笔记
              <span className={`pt-fo-save pt-fo-save-${saveState}`}>{
                saveState === 'saving' ? '保存中…'
                  : saveState === 'error' ? '保存失败'
                    : saveState === 'saved' ? '已保存 ✓' : ''
              }</span>
            </div>
            <textarea
              className="pt-fo-textarea"
              value={notes}
              placeholder="随手记：思路、待查、解题步骤……"
              onChange={event => onNotesInput(event.target.value)}
            />
          </div>
        </aside>

        <div className="pt-fo-right">
          <div className="pt-fo-toolbar">
            <div className="pt-fo-progress">
              {quantized && task !== null ? (
                <div className="pt-fo-progress-row">
                  <span className="pt-fo-progress-label">进度</span>
                  <button
                    type="button"
                    className="pt-ghost"
                    disabled={busy}
                    title="减 1"
                    onClick={() => commitProgress(Math.max(0, task.progress.current - 1))}
                  >−</button>
                  <button
                    type="button"
                    className={bar === null ? 'pt-fo-bar' : 'pt-fo-bar pt-fo-bar-active'}
                    aria-label={`${task.title} 进度`}
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={shownCount}
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      setBar(ratioFromPointer(event, event.currentTarget))
                    }}
                    onPointerMove={(event) => {
                      if (bar === null) return
                      setBar(ratioFromPointer(event, event.currentTarget))
                    }}
                    onPointerUp={(event) => {
                      if (bar === null) return
                      const next = Math.max(0, Math.min(total, Math.round(ratioFromPointer(event, event.currentTarget) * total)))
                      setBar(null)
                      if (next !== task.progress.current) commitProgress(next)
                    }}
                    onPointerCancel={() => setBar(null)}
                    onKeyDown={(event) => {
                      const step = (delta: number): void =>
                        commitProgress(Math.max(0, Math.min(total, task.progress.current + delta)))
                      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); step(1) }
                      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); step(-1) }
                      else if (event.key === 'Home') { event.preventDefault(); commitProgress(0) }
                      else if (event.key === 'End') { event.preventDefault(); commitProgress(total) }
                    }}
                  >
                    <span className="pt-fo-fill" style={{ width: `${percentOf(shownRatio)}%` }} />
                    <span className="pt-fo-thumb" style={{ left: `${percentOf(shownRatio)}%` }} />
                    {[...task.checkpoints].sort((a, b) => a.at - b.at).map(checkpoint => (
                      <span
                        key={checkpoint.id}
                        className={shownCount >= checkpoint.at ? 'pt-fo-tick pt-fo-tick-ok' : 'pt-fo-tick'}
                        style={{ left: `${percentOf(Math.min(1, checkpoint.at / total))}%` }}
                      />
                    ))}
                  </button>
                  <button
                    type="button"
                    className="pt-ghost"
                    disabled={busy}
                    title="加 1"
                    onClick={() => commitProgress(Math.min(total, task.progress.current + 1))}
                  >＋</button>
                  <span className="pt-fo-reading"><b>{fractionText(shownCount)}</b>/{fractionText(total)}</span>
                </div>
              ) : isTask && task !== null ? (
                <div className="pt-fo-progress-row">
                  <button
                    type="button"
                    className="pt-primary"
                    disabled={busy}
                    onClick={() => commitProgress(task.state === 'done' ? 0 : 1)}
                  >{task.state === 'done' ? '标记未完成' : '标记完成'}</button>
                </div>
              ) : null}

              {quantized && task !== null ? (
                <div className="pt-fo-checkpoints">
                  {[...task.checkpoints].sort((a, b) => a.at - b.at).map(checkpoint => (
                    <button
                      key={checkpoint.id}
                      type="button"
                      className={task.progress.current >= checkpoint.at ? 'pt-fo-cp pt-fo-cp-ok' : 'pt-fo-cp'}
                      title="进度跳到这里"
                      disabled={busy}
                      onClick={() => commitProgress(checkpoint.at)}
                    >
                      <span className="pt-fo-dot" />
                      {checkpoint.label} @{checkpoint.at} · {task.progress.current >= checkpoint.at ? '已到' : '未到'}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="pt-fo-controls">
              <button
                type="button"
                className="pt-fo-ctl"
                title="切换浏览器全屏"
                onClick={() => {
                  const element = root.current
                  if (document.fullscreenElement !== null) {
                    void document.exitFullscreen().catch(() => {})
                  } else if (element !== null && element.requestFullscreen !== undefined) {
                    void element.requestFullscreen().catch(() => setError('浏览器拒绝了全屏请求，已用页内全屏'))
                  }
                }}
              >
                <span className="pt-fo-ctl-icon">⤢</span>
                <span>{fullscreen ? '退出全屏' : '屏幕全屏'}</span>
              </button>
              <button type="button" className="pt-fo-ctl pt-fo-ctl-danger" title="退出专注（Esc）" onClick={() => void close()}>
                <span className="pt-fo-ctl-icon">×</span>
                <span>退出专注</span>
              </button>
            </div>
          </div>

          <div className="pt-fo-materials">
            <div className="pt-fo-mat-col">
              <div className="pt-fo-mat-head">
                <span className="pt-fo-mat-title">素材</span>
                <span className="pt-fo-mat-meta">{materialsLabel(entry.materials)}</span>
                <span className="pt-grow" />
                <div className="pt-fo-mat-actions">
                  <button type="button" className="pt-ghost" disabled={busy} onClick={() => void addBlock()}>＋ 文本</button>
                  <button
                    type="button"
                    className="pt-primary"
                    disabled={busy}
                    onClick={() => picker.current?.click()}
                  >添加图片…</button>
                </div>
              </div>

              <input
                ref={picker}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  // Reset so picking the same file twice fires again.
                  event.target.value = ''
                  void addImages(files)
                }}
              />

              <div className="pt-fo-drop">粘贴或拖入图片</div>

              <div className="pt-fo-list">
                {entry.materials.map(material => material.kind === 'md' ? (
                  <div className="pt-fo-md" key={material.id}>
                    <div className="pt-fo-md-head">
                      <span className="pt-badge">文本 · Markdown</span>
                      {editing.has(material.id)
                        ? (
                          <button
                            type="button"
                            className="pt-ghost"
                            onClick={() => {
                              window.clearTimeout(blockTimers.current.get(material.id))
                              const text = drafts[material.id] ?? material.text
                              setEditing((current) => {
                                const next = new Set(current)
                                next.delete(material.id)
                                return next
                              })
                              void run(() => client.patchTextMaterial(target.kind, target.id, material.id, text))
                            }}
                          >完成编辑</button>
                        )
                        : (
                          <button
                            type="button"
                            className="pt-ghost"
                            onClick={() => {
                              setDrafts(current => ({ ...current, [material.id]: material.text }))
                              setEditing(current => new Set(current).add(material.id))
                            }}
                          >编辑</button>
                        )}
                      <span className="pt-grow" />
                      <IconButton label="删除这块" disabled={busy} onClick={() => void removeMaterial(material.id)}>×</IconButton>
                    </div>
                    {editing.has(material.id)
                      ? (
                        <textarea
                          className="pt-fo-md-edit"
                          value={drafts[material.id] ?? material.text}
                          placeholder="Markdown"
                          onChange={(event) => {
                            const text = event.target.value
                            setDrafts(current => ({ ...current, [material.id]: text }))
                            writeBlock(material.id, text)
                          }}
                        />
                      )
                      : <Markdown source={material.text} />}
                  </div>
                ) : material.mime === undefined ? (
                  // The reference outlived its bytes — a hand-edited file can do
                  // this even though the import refuses it. Say so instead of
                  // drawing a broken picture with no explanation.
                  <div className="pt-fo-img-missing" key={material.id}>
                    <span className="pt-muted">图片缺失：{material.name ?? material.assetId}</span>
                    <button
                      type="button"
                      className="pt-ghost"
                      disabled={busy}
                      onClick={() => void removeMaterial(material.id)}
                    >移除这条</button>
                  </div>
                ) : (
                  <div className="pt-fo-img-wrap" key={material.id}>
                    <div className={zoomed === material.id ? 'pt-fo-img-scroller' : undefined}>
                      <img
                        className={zoomed === material.id ? 'pt-fo-img pt-fo-img-full' : 'pt-fo-img'}
                        src={client.assetUrl(material.assetId)}
                        alt={material.name ?? '素材图'}
                        title={zoomed === material.id ? '缩回整页适应' : '查看原始尺寸'}
                        onClick={() => setZoomed(current => (current === material.id ? null : material.id))}
                      />
                    </div>
                    <button
                      type="button"
                      className="pt-fo-img-del"
                      title="删除这张"
                      disabled={busy}
                      onClick={() => void removeMaterial(material.id)}
                    >×</button>
                  </div>
                ))}
              </div>

              {error === null ? null : <div className="pt-error">{error}</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** `HH:mm`-keyed date of an instant, for the "due today" comparison. */
function clockDate(ms: number): string {
  const at = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/** `3 文本 · 2 图 · 1.4 MB`, or `空` for no materials at all. */
function materialsLabel(materials: readonly Material[]): string {
  const texts = materials.filter(material => material.kind === 'md').length
  const images = materials.filter(material => material.kind === 'image')
  const bytes = images.reduce((sum, image) => sum + (image.bytes ?? 0), 0)
  if (materials.length === 0) return '空'
  const size = bytes === 0
    ? ''
    : ` · ${bytes > 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`}`
  return `${texts} 文本 · ${images.length} 图${size}`
}
