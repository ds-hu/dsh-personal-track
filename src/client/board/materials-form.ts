/**
 * Materials while a create/edit form is open.
 *
 * Focus mode writes a material the moment you add one — the entry already
 * exists, so there is somewhere for it to land. A *form* has no such place: a
 * new task has no id until it is submitted, and an edited one must not lose a
 * half-typed block if the user backs out. So the form stages, and this module is
 * the whole of that staging: what an item is, how an entry's stored materials
 * become items, and the ordered writes that turn items back into materials once
 * the entry exists.
 *
 * Everything here is pure apart from {@link applyMaterialWrites}, which only
 * calls the client it is handed — so the rules are testable without a DOM.
 */
import type { EntryAnswer, HabitClient, ImageInput, Viewpoint } from '../api.ts'
import type { Material, RegistryKind } from '../types.ts'

/** A Markdown block: staged text, or an existing material being rewritten. */
export interface StagedText {
  readonly key: string
  readonly kind: 'md'
  /** What the block says now, edits included. */
  readonly text: string
  /** Absent for a block that does not exist yet. */
  readonly materialId?: string
  /** What it said when the form opened, so "unchanged" is not a write. */
  readonly original?: string
}

/** An image that is already stored on the entry. */
export interface StagedHeldImage {
  readonly key: string
  readonly kind: 'image'
  readonly materialId: string
  readonly assetId: string
  readonly name?: string
  readonly mime?: string
  readonly bytes?: number
}

/** An image that exists only inside the form so far. */
export interface StagedNewImage {
  readonly key: string
  readonly kind: 'image'
  /** Already read into the wire's shape, so submitting does not re-read it. */
  readonly image: ImageInput
  readonly bytes: number
}

/** One material as the form holds it. */
export type StagedMaterial = StagedText | StagedHeldImage | StagedNewImage

/** One write that lands a staged item; a form's submit is a list of these. */
export type MaterialOp =
  | { readonly op: 'remove'; readonly materialId: string }
  | { readonly op: 'addText'; readonly text: string }
  | { readonly op: 'addImage'; readonly image: ImageInput }
  | { readonly op: 'patchText'; readonly materialId: string; readonly text: string }

/** A React key that does not collide with a stored material id. */
let staged = 0
function nextKey(): string {
  staged += 1
  return `staged-${staged}`
}

/**
 * The items a form opens with for an entry's stored materials.
 *
 * @param materials - the entry's materials, in their stored order.
 * @returns one item each, ready to edit.
 */
export function stagedFrom(materials: readonly Material[]): readonly StagedMaterial[] {
  return materials.map((material): StagedMaterial => material.kind === 'md'
    ? { key: nextKey(), kind: 'md', text: material.text, materialId: material.id, original: material.text }
    : {
        key: nextKey(),
        kind: 'image',
        materialId: material.id,
        assetId: material.assetId,
        ...(material.name === undefined ? {} : { name: material.name }),
        ...(material.mime === undefined ? {} : { mime: material.mime }),
        ...(material.bytes === undefined ? {} : { bytes: material.bytes }),
      })
}

/** A fresh, empty Markdown block — what "＋ 文本" appends. */
export function newTextBlock(): StagedText {
  return { key: nextKey(), kind: 'md', text: '' }
}

/** A freshly read image, ready to stage. */
export function newImageItem(image: ImageInput, bytes: number): StagedNewImage {
  return { key: nextKey(), kind: 'image', image, bytes }
}

/**
 * The writes that turn the staged items into materials, in one order.
 *
 * Removals come first: an id that is about to disappear must not be re-read by a
 * later step. Additions follow in the order the items are shown, so the stored
 * stream reads the way the form did. Rewrites come last — they can only apply to
 * blocks that already exist.
 *
 * Nothing is emitted for an unchanged block or for a held image: the form is a
 * *view* of the entry, and re-writing what it already says would be a write the
 * user never asked for (and, for an image, a second copy of the bytes).
 *
 * @param items - what the form holds, in display order.
 * @param removed - material ids the user deleted from the entry.
 * @returns the writes, in the order they must be issued.
 */
export function planMaterialWrites(
  items: readonly StagedMaterial[],
  removed: readonly string[] = [],
): readonly MaterialOp[] {
  const ops: MaterialOp[] = []
  for (const materialId of removed) ops.push({ op: 'remove', materialId })
  for (const item of items) {
    if (item.kind === 'image') {
      if ('image' in item) ops.push({ op: 'addImage', image: item.image })
      continue
    }
    if (item.materialId === undefined) ops.push({ op: 'addText', text: item.text })
  }
  for (const item of items) {
    if (item.kind !== 'md' || item.materialId === undefined) continue
    if (item.text === item.original) continue
    ops.push({ op: 'patchText', materialId: item.materialId, text: item.text })
  }
  return ops
}

/**
 * The stored material id an item stands for, if it stands for one.
 *
 * An item the user just staged has no id yet; one seeded from the entry does.
 * Removing the former is nothing to undo, removing the latter is a write.
 *
 * @param item - one staged item.
 * @returns the stored id, or `undefined`.
 */
export function storedIdOf(item: StagedMaterial): string | undefined {
  if (item.kind === 'md') return item.materialId
  return 'image' in item ? undefined : item.materialId
}

/** What the form's own summary line counts. */
export interface MaterialTally {
  readonly texts: number
  readonly images: number
  readonly bytes: number
}

/**
 * Count what is staged, for the section's meta line.
 *
 * @param items - the staged items.
 * @returns blocks, images, and the total size of the images.
 */
export function tallyOf(items: readonly StagedMaterial[]): MaterialTally {
  let texts = 0
  let images = 0
  let bytes = 0
  for (const item of items) {
    if (item.kind === 'md') {
      texts += 1
      continue
    }
    images += 1
    bytes += 'image' in item ? item.bytes : item.bytes ?? 0
  }
  return { texts, images, bytes }
}

/**
 * Land planned writes on an entry, one after another.
 *
 * Sequential rather than parallel on purpose: the host answers every write with
 * the day's slice, and the client adopts the last one — issuing them at once
 * would let an earlier answer overwrite a later one.
 *
 * @param ops - the plan, from {@link planMaterialWrites}.
 * @param owner - which registry the entry is in.
 * @param id - the entry's id.
 * @param client - the API surface (a test passes a stub).
 * @param viewpoint - the habit day the answers should describe.
 * @returns the last answer, or `undefined` when there was nothing to do.
 */
export async function applyMaterialWrites(
  ops: readonly MaterialOp[],
  owner: RegistryKind,
  id: string,
  client: Pick<HabitClient, 'addImageMaterial' | 'addTextMaterial' | 'patchTextMaterial' | 'removeMaterial'>,
  viewpoint?: Viewpoint,
): Promise<EntryAnswer | undefined> {
  let last: EntryAnswer | undefined
  for (const op of ops) {
    switch (op.op) {
      case 'remove':
        last = await client.removeMaterial(owner, id, op.materialId, viewpoint)
        break
      case 'addText':
        last = await client.addTextMaterial(owner, id, op.text, viewpoint)
        break
      case 'addImage':
        last = await client.addImageMaterial(owner, id, op.image, viewpoint)
        break
      case 'patchText':
        last = await client.patchTextMaterial(owner, id, op.materialId, op.text, viewpoint)
        break
    }
  }
  return last
}
