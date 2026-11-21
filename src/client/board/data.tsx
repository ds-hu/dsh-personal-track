/**
 * Data in and out: download the whole habit domain as one JSON file, or read
 * one back.
 *
 * Import is two-step on purpose. Picking a file only *parses* it and shows what
 * it holds; nothing is written until a mode is chosen, and the destructive mode
 * (`replace`, which also drops every record the file omits) is labelled as such.
 * The file is validated by the host before any of it is applied.
 *
 * The image prune is two-step for the same reason and a different one: picking
 * *which* images go is a rule the host owns (the ones on finished entries), so
 * the only thing left to decide is whether to lose them — and the answer is a
 * count and a size, shown before the button that commits, not after.
 */
import { useReducer, useRef, useState, type JSX } from 'react'
import type { HabitClient } from '../api.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import type { BackupBundle, ImportMode } from '../types.ts'
import { IMPORT_IDLE, importer, isBusy, stagedFile, type StagedFile } from './editor-state.ts'
import { messageOf } from './format.ts'
import { byteSizeText } from './image-input.ts'
import { IconButton, Tile, TileHead } from './tile.tsx'

/** A file bigger than this is refused before it is parsed. */
const MAX_FILE_BYTES = 64 * 1024 * 1024

/** `YYY-MM-DD` from an ISO instant, for the download's name. */
function fileStamp(iso: string): string {
  return iso.slice(0, 10)
}

/** Read a picked file and check it looks like one of ours. */
async function stage(file: File, t: Copy): Promise<StagedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error(t('data.tooBig'))
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error(t('data.badJson'))
  }
  const shape = parsed as Partial<BackupBundle> | null
  if (shape === null || typeof shape !== 'object' || !Array.isArray(shape.days)) {
    throw new Error(t('data.notBackup'))
  }
  return { name: file.name, bundle: shape as BackupBundle }
}

/**
 * The image prune's two steps: the staged confirm, then the request itself.
 *
 * One value rather than two flags: "confirming and working at once" is not a
 * state, and a pair of booleans makes it representable.
 */
type PruneStage = 'idle' | 'confirm' | 'working'

/** Props for the data card. */
export interface DataCardProps {
  readonly client: HabitClient
  /** The images the host says sit on finished entries: what the prune takes. */
  readonly completedImages: { readonly count: number; readonly bytes: number }
  /** Called after a write that changed stored data, so the panel re-reads it. */
  readonly onChanged: () => void
}

/** Export the domain, import one back, or reclaim the images on finished entries. */
export function DataCard({ client, completedImages, onChanged }: DataCardProps): JSX.Element {
  const t = useCopy()
  const picker = useRef<HTMLInputElement | null>(null)
  // One value instead of four flags: "staged and failed at once" is not
  // representable, so a failed attempt cannot hide the file it was retrying.
  const [importState, dispatch] = useReducer(importer, IMPORT_IDLE)
  const [pruneStage, setPruneStage] = useState<PruneStage>('idle')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = stagedFile(importState)
  const busy = isBusy(importState) || pruneStage === 'working'

  const report = (cause: unknown): void => {
    setError(messageOf(cause, t))
  }

  /** Download the backup the host just built. */
  const download = async (): Promise<void> => {
    try {
      const backup = await client.exportAll()
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `personal-track-${fileStamp(backup.exportedAt)}.json`
      link.click()
      URL.revokeObjectURL(url)
      setError(null)
      setNote(t('data.exported', { days: backup.days.length }))
    } catch (cause) {
      report(cause)
    }
  }

  /** Pick a file: parse it, but write nothing yet. */
  const pick = async (picked: File | undefined): Promise<void> => {
    if (picked === undefined) return
    dispatch({ kind: 'pick' })
    try {
      dispatch({ kind: 'picked', file: await stage(picked, t) })
      setError(null)
      setNote(null)
    } catch (cause) {
      dispatch({ kind: 'pick-failed' })
      report(cause)
    }
  }

  const apply = async (mode: ImportMode): Promise<void> => {
    if (file === null) return
    dispatch({ kind: 'apply' })
    try {
      const result = await client.importAll(mode, file.bundle)
      const { report: done } = result
      dispatch({ kind: 'imported' })
      setError(null)
      setNote(t('data.imported', {
        days: done.days,
        media: done.media,
        tasks: done.tasks,
        todos: done.todos,
        presence: done.presence,
      })
        + (done.assets === 0 ? '' : t('data.imported.assets', { count: done.assets }))
        + (done.removed === 0 ? '' : t('data.imported.removed', { count: done.removed })))
      onChanged()
    } catch (cause) {
      dispatch({ kind: 'import-failed' })
      report(cause)
    }
  }

  /** Delete every material image nothing references. */
  const sweep = async (): Promise<void> => {
    try {
      const result = await client.sweepAssets()
      setError(null)
      setNote(result.removed === 0
        ? t('data.nothingToSweep')
        : t('data.swept', { count: result.removed }))
    } catch (cause) {
      report(cause)
    }
  }

  /**
   * Stage the image prune: show what it would take before it takes anything.
   *
   * Nothing to take is answered here rather than by a hidden button — a control
   * that disappears at zero leaves the reader wondering whether it was ever
   * there, and this card already answers "nothing to sweep" the same way.
   */
  const askPrune = (): void => {
    setError(null)
    if (completedImages.count === 0) {
      setNote(t('data.nothingToPrune'))
      return
    }
    setNote(null)
    setPruneStage('confirm')
  }

  /** Commit it. The answer is a state slice, so there is nothing to re-read. */
  const prune = async (): Promise<void> => {
    setPruneStage('working')
    try {
      const result = await client.pruneImages()
      const size = byteSizeText(result.bytes)
      setError(null)
      if (result.images === 0) {
        // The number that staged this confirm was already stale — another
        // window pruned first — so say that instead of "deleted 0 images".
        setNote(t('data.nothingToPrune'))
      } else if (size === '') {
        // A count with nothing to weigh: those images were dangling references
        // whose bytes were already gone, and a sentence with an empty "·" would
        // be the only trace of them.
        setNote(t('data.prunedCount', { count: result.images }))
      } else {
        setNote(t('data.pruned', { count: result.images, size }))
      }
      setPruneStage('idle')
      onChanged()
    } catch (cause) {
      setPruneStage('idle')
      report(cause)
    }
  }

  // A staged import steps aside while the prune asks its question: two confirms
  // in one card is two answers to "what am I about to lose".
  const shown = pruneStage === 'idle' ? file : null
  const staged = shown === null ? null : shown.bundle as Partial<BackupBundle>
  return (
    <Tile span={2}>
      <TileHead title={t('data.title')} meta={shown === null ? undefined : t('data.pending', { name: shown.name })} />
      <div className="pt-rows">
        {pruneStage === 'idle'
          ? (
            <div className="pt-tile-foot">
              <button type="button" className="pt-primary" disabled={busy} onClick={() => void download()}>{t('data.export')}</button>
              <button type="button" className="pt-ghost" disabled={busy} onClick={() => picker.current?.click()}>
                {t('data.pick')}
              </button>
              <button type="button" className="pt-ghost" disabled={busy} onClick={() => void sweep()}>
                {t('data.sweep')}
              </button>
              <button type="button" className="pt-ghost" disabled={busy} onClick={askPrune}>
                {t('data.prune')}
              </button>
            </div>
          )
          : (
            <div className="pt-confirm">
              <span className="pt-muted">
                {t('data.prune.confirm', {
                  count: completedImages.count,
                  size: byteSizeText(completedImages.bytes),
                })}
              </span>
              <button
                type="button"
                className="pt-ghost pt-danger"
                disabled={pruneStage === 'working'}
                onClick={() => void prune()}
              >
                {t('data.prune.do', { count: completedImages.count })}
              </button>
              <button
                type="button"
                className="pt-ghost"
                disabled={pruneStage === 'working'}
                onClick={() => setPruneStage('idle')}
              >
                {t('form.cancel')}
              </button>
            </div>
          )}
        <input
          ref={picker}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(event) => {
            const picked = event.target.files?.[0]
            // Reset so picking the same file twice fires again.
            event.target.value = ''
            void pick(picked)
          }}
        />

        {staged === null ? null : (
          <div className="pt-tile-foot">
            <span className="pt-muted">
              {t('data.staged', {
                days: staged.days?.length ?? 0,
                media: staged.media?.length ?? 0,
                tasks: staged.tasks?.length ?? 0,
                todos: staged.todos?.length ?? 0,
                presence: (staged.presence ?? []).reduce((sum, day) => sum + day.events.length, 0),
              })}
            </span>
            <span className="pt-grow" />
            <button type="button" className="pt-primary" disabled={busy} onClick={() => void apply('merge')}>{t('data.merge')}</button>
            <button type="button" className="pt-ghost" disabled={busy} onClick={() => void apply('replace')}>
              {t('data.replace')}
            </button>
            <IconButton
              label={t('data.cancel')}
              disabled={busy}
              onClick={() => { dispatch({ kind: 'cancel' }); setError(null) }}
            >×</IconButton>
          </div>
        )}

        {error !== null
          ? <div className="pt-error">{error}</div>
          : (
            <span className="pt-muted">
              {note ?? t('data.note')}
            </span>
          )}
      </div>
    </Tile>
  )
}
