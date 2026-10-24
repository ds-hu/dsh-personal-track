/**
 * personal-track — host half.
 *
 * Opens the habit storage domain and serves the plugin's own JSON API on
 * `ctx.webServer`. Transport rationale: docs/adr/0001-out-of-tree-transport.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { API_PREFIX, createApiHandler } from './api.ts'
import { createBackup } from './backup.ts'
import { Config, boundaryOf, clockOf } from './config.ts'
import { habitDomainSpec } from './domain.ts'
import { createHabitStore } from './store.ts'

/**
 * Plugin name (diagnostics, effect labels); the patch row's `id` equals this.
 *
 * Deliberately *not* the package name (`@ds-hu/personal-track`): the row id is
 * the key a profile patch overrides and the name every effect label carries, so
 * it stays the short one. What has to be the package name is the row's `name`
 * (the module specifier the Loader resolves) and the browser module id.
 */
export const name = 'personal-track'

/** Required services: both must be live before `apply` runs. */
export const inject = ['storageDomain', 'webServer']

export { Config }

/** Open the domain, build the store, and serve the API. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(habitDomainSpec)
  ctx.effect(() => () => domain.close(), 'personal-track: close habit domain')

  const handler = createApiHandler({
    store: createHabitStore(domain, config),
    backup: createBackup(domain),
    boundary: boundaryOf(config),
    config,
    // The one time seam: production gets the host's clock, and a verification
    // can pass its own through `config.now` instead of racing the wall clock.
    now: clockOf(config),
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler,
  }), 'personal-track: /habit/api routes')
}
