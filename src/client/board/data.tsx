/**
 * Data in and out: download the whole habit domain as one JSON file, or read
 * one back.
 *
 * Import is two-step on purpose. Picking a file only *parses* it and shows what
 * it holds; nothing is written until a mode is chosen, and the destructive mode
 * (`replace`, which also drops every record the file omits) is labelled as such.
 * The file is validated by the host before any of it is applied.
 */
import { useReducer, useRef, useState, type JSX } from 'react'
import type { HabitClient } from '../api.ts'
import { useCopy, type Copy } from '../copy/index.tsx'
import type { BackupBundle, ImportMode } from '../types.ts'
import { IMPORT_IDLE, importer, isBusy, stagedFile, type StagedFile } from './editor-state.ts'
import { messageOf } from './format.ts'
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

/** Props for the data card. */
export interface DataCardProps {
  readonly client: HabitClient
  /** Called after a successful import so the panel can re-read its range. */
  readonly onImported: () => void
}

/** Export the domain, or import one back. */
export function DataCard({ client, onImported }: DataCardProps): JSX.Element {
  const t = useCopy()
  const picker = useRef<HTMLInputElement | null>(null)
  // One value instead of four flags: "staged and failed at once" is not
  // representable, so a failed attempt cannot hide the file it was retrying.
  const [importState, dispatch] = useReducer(importer, IMPORT_IDLE)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = stagedFile(importState)
  const busy = isBusy(importState)

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
      setNote(t('data.imported', { days: done.days, media: done.media, tasks: done.tasks })
        + (done.assets === 0 ? '' : t('data.imported.assets', { count: done.assets }))
        + (done.removed === 0 ? '' : t('data.imported.removed', { count: done.removed })))
      onImported()
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

  const staged = file === null ? null : file.bundle as Partial<BackupBundle>
  return (
    <Tile span={2}>
      <TileHead title={t('data.title')} meta={file === null ? undefined : t('data.pending', { name: file.name })} />
      <div className="pt-rows">
        <div className="pt-tile-foot">
          <button type="button" className="pt-primary" disabled={busy} onClick={() => void download()}>{t('data.export')}</button>
          <button type="button" className="pt-ghost" disabled={busy} onClick={() => picker.current?.click()}>
            {t('data.pick')}
          </button>
          <button type="button" className="pt-ghost" disabled={busy} onClick={() => void sweep()}>
            {t('data.sweep')}
          </button>
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
        </div>

        {staged === null ? null : (
          <div className="pt-tile-foot">
            <span className="pt-muted">
              {t('data.staged', {
                days: staged.days?.length ?? 0,
                media: staged.media?.length ?? 0,
                tasks: staged.tasks?.length ?? 0,
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
