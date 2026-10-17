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
async function stage(file: File): Promise<StagedFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error('文件超过 64 MB，可能不是本插件的备份')
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error('文件不是合法的 JSON')
  }
  const shape = parsed as Partial<BackupBundle> | null
  if (shape === null || typeof shape !== 'object' || !Array.isArray(shape.days)) {
    throw new Error('这不是本插件的备份文件')
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
  const picker = useRef<HTMLInputElement | null>(null)
  // One value instead of four flags: "staged and failed at once" is not
  // representable, so a failed attempt cannot hide the file it was retrying.
  const [importState, dispatch] = useReducer(importer, IMPORT_IDLE)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const file = stagedFile(importState)
  const busy = isBusy(importState)

  const report = (cause: unknown): void => {
    setError(messageOf(cause))
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
      setNote(`已导出 ${backup.days.length} 天记录`)
    } catch (cause) {
      report(cause)
    }
  }

  /** Pick a file: parse it, but write nothing yet. */
  const pick = async (picked: File | undefined): Promise<void> => {
    if (picked === undefined) return
    dispatch({ kind: 'pick' })
    try {
      dispatch({ kind: 'picked', file: await stage(picked) })
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
      setNote(`导入完成：${done.days} 天、${done.media} 影视书籍、${done.tasks} 任务`
        + (done.assets === 0 ? '' : `、${done.assets} 张图片`)
        + (done.removed === 0 ? '' : `，清掉 ${done.removed} 条本地多余记录`))
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
      setNote(result.removed === 0 ? '没有可清理的图片' : `已清理 ${result.removed} 张未引用的图片`)
    } catch (cause) {
      report(cause)
    }
  }

  return (
    <Tile span={2}>
      <TileHead title="数据" meta={file === null ? undefined : `待导入 ${file.name}`} />
      <div className="pt-rows">
        <div className="pt-tile-foot">
          <button type="button" className="pt-primary" disabled={busy} onClick={() => void download()}>导出</button>
          <button type="button" className="pt-ghost" disabled={busy} onClick={() => picker.current?.click()}>
            选择备份…
          </button>
          <button type="button" className="pt-ghost" disabled={busy} onClick={() => void sweep()}>
            清理未引用图片
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

        {file === null ? null : (
          <div className="pt-tile-foot">
            <span className="pt-muted">
              {(file.bundle as Partial<BackupBundle>).days?.length ?? 0} 天、
              {(file.bundle as Partial<BackupBundle>).media?.length ?? 0} 影视书籍、
              {(file.bundle as Partial<BackupBundle>).tasks?.length ?? 0} 任务
            </span>
            <span className="pt-grow" />
            <button type="button" className="pt-primary" disabled={busy} onClick={() => void apply('merge')}>合并</button>
            <button type="button" className="pt-ghost" disabled={busy} onClick={() => void apply('replace')}>
              覆盖（清空现有）
            </button>
            <IconButton
              label="取消导入"
              disabled={busy}
              onClick={() => { dispatch({ kind: 'cancel' }); setError(null) }}
            >×</IconButton>
          </div>
        )}

        {error !== null
          ? <div className="pt-error">{error}</div>
          : (
            <span className="pt-muted">
              {note ?? '合并：文件中的记录覆盖同键项；覆盖：文件里没有的本地记录会被删除'}
            </span>
          )}
      </div>
    </Tile>
  )
}
