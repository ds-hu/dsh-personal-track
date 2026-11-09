/**
 * Reading a pasted or picked image into the wire's shape.
 *
 * One implementation for both surfaces that take an image — focus mode and the
 * task form — because the refusal it produces is part of the contract: the size
 * cap is the same constant the host enforces, and a file the browser cannot type
 * is refused here rather than guessed at later.
 */
import type { Copy } from '../copy/index.tsx'
import { MAX_IMAGE_BYTES } from '../../shared/route.ts'

/** One image on its way into the store, as the API carries it. */
export interface ImageInput {
  readonly mime: string
  /** Base64 payload, without the `data:` prefix. */
  readonly data: string
  readonly name: string
}

/**
 * Read one image file into {@link ImageInput}, or explain why it cannot go.
 *
 * @param file - what the picker, a drop or the clipboard handed over.
 * @param copy - the panel's words, for the three refusals.
 * @returns the base64 payload with its mime and name.
 */
export function imageInputOf(file: File, copy: Copy): Promise<ImageInput> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error(copy('material.tooBig', {
        name: file.name,
        limit: Math.round(MAX_IMAGE_BYTES / 1024 / 1024),
      })))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(copy('material.unreadable', { name: file.name })))
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      // A data URL is `data:<mime>;base64,<payload>`; both halves are needed,
      // and a file the browser could not type is refused rather than guessed at.
      const comma = url.indexOf(',')
      const header = url.slice(0, comma)
      const mime = /^data:([^;,]+)/.exec(header)?.[1]
      if (comma < 0 || mime === undefined) {
        reject(new Error(copy('material.notImage', { name: file.name })))
        return
      }
      resolve({ mime, data: url.slice(comma + 1), name: file.name })
    }
    reader.readAsDataURL(file)
  })
}

/**
 * A byte count as the reader would say it: megabytes with one decimal above a
 * mebibyte, whole kilobytes below it, and nothing at all for no bytes.
 *
 * @param bytes - a stored or measured size.
 * @returns e.g. `1.2 MB`, `820 KB`, or `''`.
 */
export function byteSizeText(bytes: number): string {
  if (!(bytes > 0)) return ''
  return bytes > 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}
