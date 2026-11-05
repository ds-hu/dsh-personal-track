/**
 * The completion bar: one small square per cell plus the `n/m` count.
 *
 * A cell is a fraction, not a flag — vocabulary and the tasks due today fill
 * theirs by how far along they are — so each square shows a green fill at that
 * level, and the count keeps a decimal when it needs one.
 */
import type { JSX } from 'react'
import { useCopy, type Copy } from '../copy/index.tsx'
import type { Cell } from '../types.ts'
import { fractionText, percentOf } from './format.ts'
import { cellLabel } from './names.ts'

/** Props for the chip. */
export interface ChipProps {
  readonly cells: readonly Cell[]
  readonly progress: { readonly done: number; readonly total: number }
}

/** What one cell reads as in its tooltip. */
function describe(cell: Cell, copy: Copy): string {
  const percent = percentOf(cell.value)
  if (percent <= 0) return copy('chip.missing')
  if (percent >= 100) return copy('chip.done')
  return copy('chip.progress', { percent })
}

/** Render the chip. */
export function Chip({ cells, progress }: ChipProps): JSX.Element {
  const t = useCopy()
  return (
    <div className="pt-chip">
      <div className="pt-marks">
        {cells.map((cell) => {
          const percent = percentOf(cell.value)
          return (
            <span
              key={cell.id}
              className={percent >= 100 ? 'pt-mark pt-mark-on' : 'pt-mark'}
              title={t('chip.cell', {
                label: cell.label ?? cellLabel(cell.id, t),
                state: describe(cell, t),
              })}
            >
              <span className="pt-mark-fill" style={{ width: `${percent}%` }} />
            </span>
          )
        })}
      </div>
      <span className="pt-chip-count">{fractionText(progress.done)}/{progress.total}</span>
    </div>
  )
}
