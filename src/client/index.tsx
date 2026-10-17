/**
 * personal-track — browser half.
 *
 * Registers one surface: the `习惯看板` panel in the main area (with its
 * sidebar entry), which holds both the day's board and the statistics view,
 * plus focus mode over either of them.
 *
 * The right-sidebar tab this plugin used to own is gone by decision: the board
 * and the statistics were two halves of one question — "how is today going, and
 * how has it been going" — and splitting them across two shells meant the
 * board had to hand the user off through `ctx.layout`, which is exactly the
 * kind of seam that breaks when one half reloads.
 *
 * The panel talks to the host through the command face injected into its slot
 * registration, so the component never sees `ctx`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createHabitClient } from './api.ts'
import { BoardIcon } from './board/BoardBody.tsx'
import { TrackPanel } from './board/TrackPanel.tsx'
import { ensureBoardStyles } from './styles.ts'

/**
 * Services that must be live before `apply` runs.
 *
 * Every `ctx.<prop>` service access needs its name here — cordis resolves
 * service props through the fiber's inject set and throws
 * `cannot get property "prop" without inject` otherwise. Only the two
 * registration faces are touched now, so the list is down to `slots`.
 */
export const inject = ['slots']

/** The one main-area panel this plugin owns. */
const PANEL_ID = 'personal-track-board' as MainPanelId

/** Register the panel, its body, and the sidebar entry that opens it. */
export function apply(ctx: Context): void {
  ensureBoardStyles()
  const client = createHabitClient()

  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(
    { name: 'main', key: PANEL_ID, inject: () => ({ client }) },
    TrackPanel,
  )), 'personal-track: board panel')

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
    { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => '习惯看板' },
    BoardIcon,
  )), 'personal-track: sidebar entry')
}
