/**
 * The material area inside the task form.
 *
 * It is the focus overlay's material stream, reduced to what a *form* can do:
 * the same cards (`pt-fo-md`, the image row), the same drop hint, the same file
 * reader and refusals — but staged instead of written, because a task being
 * created has no id to write against yet (`./materials-form.ts` owns that part).
 *
 * The paste and drop handlers are attached by the form, not by this section, and
 * they are element-level: a screenshot pasted into the notes box still lands
 * here, while a paste or a drop that happens anywhere else on the page is left
 * entirely alone — that is the shell's conversation, not ours.
 */
import {
  useCallback,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type JSX,
} from 'react'
import { useCopy } from '../copy/index.tsx'
import type { Material } from '../types.ts'
import { byteSizeText, imageInputOf } from './image-input.ts'
import {
  newImageItem,
  newTextBlock,
  planMaterialWrites,
  stagedFrom,
  storedIdOf,
  tallyOf,
  type MaterialOp,
  type StagedMaterial,
} from './materials-form.ts'
import { IconButton } from './tile.tsx'

/**
 * What a form needs from the material area: the section itself, the three
 * handlers that catch a paste or a drop anywhere in the form, and the writes its
 * current contents imply.
 */
export interface MaterialSection {
  readonly node: JSX.Element
  readonly onPaste: (event: ReactClipboardEvent<HTMLElement>) => void
  readonly onDrop: (event: ReactDragEvent<HTMLElement>) => void
  readonly onDragOver: (event: ReactDragEvent<HTMLElement>) => void
  /** Recomputed on every render, so submit always sees the latest edits. */
  readonly ops: readonly MaterialOp[]
}

/**
 * Whether a drag carries files, whichever shape the browser exposes `types` in.
 *
 * A modern browser hands over a frozen array; the older `DOMStringList` has
 * `contains` and index access but no `includes`. `dragover` throwing its way out
 * of React is not a failure a drop target can afford, so both shapes are read.
 */
function carriesFiles(data: DataTransfer): boolean {
  const types = data.types as unknown as {
    readonly length: number
    includes?: (value: string) => boolean
    readonly [index: number]: string
  }
  if (typeof types.includes === 'function') return types.includes('Files')
  for (let index = 0; index < types.length; index += 1) {
    if (types[index] === 'Files') return true
  }
  return false
}

/** The image files a clipboard or a drop carried. */
function filesOf(data: DataTransfer | null): readonly File[] {
  if (data === null) return []
  const files: File[] = []
  // Indexed loops rather than `for…of`: `DataTransferItemList` and `FileList`
  // are iterable in every browser that runs this, but not in the DOM types the
  // plugin compiles against.
  for (let index = 0; index < data.items.length; index += 1) {
    const item = data.items[index]
    if (item === undefined || item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file !== null) files.push(file)
  }
  if (files.length > 0) return files
  // A drop from the desktop may carry files with no `items` entry at all.
  for (let index = 0; index < data.files.length; index += 1) {
    const file = data.files.item(index)
    if (file !== null && file.type.startsWith('image/')) files.push(file)
  }
  return files
}

/**
 * Own the staged materials of one open form.
 *
 * Must be called from a component that is mounted while the form is open: the
 * staged list is the form's own state, so opening the editor again starts from
 * the entry rather than from the last, abandoned attempt.
 *
 * @param initial - the entry's stored materials (empty for a new task).
 * @param assetUrl - where a stored image's bytes come from.
 * @param onProblem - the form's error line, for a refused file.
 * @returns the section to render plus what submitting it implies.
 */
export function useMaterialSection(options: {
  readonly initial: readonly Material[]
  readonly assetUrl?: (assetId: string) => string
  readonly onProblem: (message: string) => void
  /** True while the form's own write is in flight: staging pauses with it. */
  readonly busy: boolean
}): MaterialSection {
  const { initial, assetUrl, onProblem, busy } = options
  const t = useCopy()
  const [items, setItems] = useState<readonly StagedMaterial[]>(() => stagedFrom(initial))
  const [removed, setRemoved] = useState<readonly string[]>([])
  const [zoomed, setZoomed] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement | null>(null)

  const addFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (files.length === 0) return
    for (const file of files) {
      try {
        const image = await imageInputOf(file, t)
        setItems(current => [...current, newImageItem(image, file.size)])
      } catch (cause) {
        onProblem(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }, [onProblem, t])

  const onPaste = useCallback((event: ReactClipboardEvent<HTMLElement>): void => {
    const files = filesOf(event.clipboardData)
    if (files.length === 0) return
    // Taken, not shared: `stopPropagation` keeps the shell's own paste handler
    // (which turns a screenshot into a conversation attachment) out of it.
    event.preventDefault()
    event.stopPropagation()
    void addFiles(files)
  }, [addFiles])

  const onDrop = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    const files = filesOf(event.dataTransfer)
    // Always taken: a drop that reaches here was aimed at this form, and the
    // browser's default for a file drop is to navigate away from the panel.
    event.preventDefault()
    event.stopPropagation()
    if (files.length === 0) {
      onProblem(t('material.noImage'))
      return
    }
    void addFiles(files)
  }, [addFiles, onProblem, t])

  const onDragOver = useCallback((event: ReactDragEvent<HTMLElement>): void => {
    // Only a file drag is ours; dragging text across the form stays the
    // browser's business.
    if (!carriesFiles(event.dataTransfer)) return
    event.preventDefault()
  }, [])

  const removeItem = useCallback((item: StagedMaterial): void => {
    setItems(current => current.filter(candidate => candidate.key !== item.key))
    // A staged item has no id to delete; only a stored one does.
    const materialId = storedIdOf(item)
    if (materialId !== undefined) setRemoved(current => [...current, materialId])
  }, [])

  const setText = useCallback((key: string, text: string): void => {
    setItems(current => current.map(item => (
      item.key === key && item.kind === 'md' ? { ...item, text } : item
    )))
  }, [])

  const sourceOf = (item: StagedMaterial): string => {
    if (item.kind === 'md') return ''
    if ('image' in item) return `data:${item.image.mime};base64,${item.image.data}`
    return assetUrl?.(item.assetId) ?? ''
  }

  /** A picture's name and size, whichever kind of image item holds it. */
  const imageInfoOf = (item: StagedMaterial): { readonly name?: string; readonly bytes: number } => {
    if (item.kind === 'md') return { bytes: 0 }
    return 'image' in item
      ? { name: item.image.name, bytes: item.bytes }
      : { ...(item.name === undefined ? {} : { name: item.name }), bytes: item.bytes ?? 0 }
  }

  const tally = tallyOf(items)
  const size = byteSizeText(tally.bytes)
  const meta = items.length === 0
    ? t('material.none')
    : `${t('material.counts', { texts: tally.texts, images: tally.images })}${size === '' ? '' : ` · ${size}`}`
  const zoomedItem = items.find(item => item.key === zoomed)

  const node = (
    <div className="pt-attach">
      <div className="pt-fo-mat-head">
        <span className="pt-fo-mat-title">{t('material.title')}</span>
        <span className="pt-fo-mat-meta">{meta}</span>
        <span className="pt-grow" />
        <div className="pt-fo-mat-actions">
          {/*
            Both are ghosts on purpose. A task form ends in one filled accent —
            its commit — and the blue `.pt-primary` this button used to wear
            competed with it forty pixels away: two "main actions" in a card
            that has exactly one. What these two do is equally weighted anyway:
            attach a block, attach an image.
          */}
          <button
            type="button"
            className="pt-ghost"
            disabled={busy}
            onClick={() => setItems(current => [...current, newTextBlock()])}
          >＋ {t('material.text')}</button>
          <button
            type="button"
            className="pt-ghost"
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            {t('material.addImage')}
          </button>
        </div>
      </div>

      <input
        ref={picker}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={(event) => {
          const chosen = event.target.files
          const files: File[] = []
          for (let index = 0; chosen !== null && index < chosen.length; index += 1) {
            const file = chosen.item(index)
            if (file !== null) files.push(file)
          }
          // Reset so picking the same file twice fires again.
          event.target.value = ''
          void addFiles(files)
        }}
      />

      <div className="pt-fo-drop">{t('material.dropHint')}</div>

      <div className="pt-fo-list">
        {items.map(item => item.kind === 'md'
          ? (
            <div className="pt-fo-md" key={item.key}>
              <div className="pt-fo-md-head">
                <span className="pt-badge">{t('material.markdown')}</span>
                <span className="pt-grow" />
                <IconButton
                  label={t('material.removeBlock')}
                  disabled={busy}
                  onClick={() => removeItem(item)}
                >×</IconButton>
              </div>
              <textarea
                className="pt-fo-md-edit"
                rows={3}
                placeholder="Markdown"
                value={item.text}
                onChange={event => setText(item.key, event.target.value)}
              />
            </div>
          )
          : (
            <div className="pt-mat-row" key={item.key}>
              <img
                className="pt-mat-thumb"
                src={sourceOf(item)}
                alt={imageInfoOf(item).name ?? t('material.imageAlt')}
                title={t('material.zoomIn')}
                onClick={() => setZoomed(current => (current === item.key ? null : item.key))}
              />
              <span
                className="pt-mat-name"
                title={imageInfoOf(item).name}
                onClick={() => setZoomed(current => (current === item.key ? null : item.key))}
              >{imageInfoOf(item).name ?? t('material.imageAlt')}</span>
              <span className="pt-mat-size">{byteSizeText(imageInfoOf(item).bytes)}</span>
              <IconButton
                label={t('material.removeImage')}
                disabled={busy}
                onClick={() => removeItem(item)}
              >×</IconButton>
            </div>
          ))}
      </div>

      {zoomedItem === undefined || zoomedItem.kind === 'md'
        ? null
        : (
          <div className="pt-zoom">
            <img
              src={sourceOf(zoomedItem)}
              alt={imageInfoOf(zoomedItem).name ?? t('material.imageAlt')}
              title={t('material.zoomOut')}
              onClick={() => setZoomed(null)}
            />
            <span className="pt-zoom-hint">{t('material.zoomOut')}</span>
          </div>
        )}
    </div>
  )

  return {
    node,
    onPaste,
    onDrop,
    onDragOver,
    ops: planMaterialWrites(items, removed),
  }
}
