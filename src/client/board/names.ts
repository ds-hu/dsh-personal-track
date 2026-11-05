/**
 * Names for what the host sends as ids.
 *
 * The host owns the **inventory** — which habits exist, which cells the
 * completion bar is built from — and the panel owns what they are *called*.
 * That split is why a habit crosses the wire as `wash` rather than as 洗漱: a
 * name is language-dependent, an id is not, and a host that answered with the
 * name would have to be restarted to change a translation.
 *
 * An id with no row falls back to itself rather than to a guessed key, so a
 * host newer than this bundle shows `stretch` instead of `habit.stretch`.
 */
import type { Copy } from '../copy/index.tsx'
import { COPY, type CopyKey } from '../copy/table.ts'

/** The name of one habit, by id. */
export function habitLabel(id: string, copy: Copy): string {
  const key = `habit.${id}` as CopyKey
  return key in COPY ? copy(key) : id
}

/** The name of one cell of the completion bar, by id. */
export function cellLabel(id: string, copy: Copy): string {
  const key = `cell.${id}` as CopyKey
  return key in COPY ? copy(key) : habitLabel(id, copy)
}
