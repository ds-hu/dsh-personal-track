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
import { PRESENCE_CHECKPOINT_MS, createPresence } from './presence.ts'
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

  const boundary = boundaryOf(config)
  // The one time seam: production gets the host's clock, and a verification
  // can pass its own through `config.now` instead of racing the wall clock.
  const now = clockOf(config)
  const presence = createPresence({ domain, boundary, now })

  // Days older than the raw window are folded into the time ledger before the
  // first request is served: a host that was down for a week would otherwise
  // keep a week of raw events until the next boundary. `void` on purpose — a
  // failure here must not stop the plugin from serving, and the checkpoint below
  // retries it.
  void presence.maintain().catch(cause => console.error('personal-track: presence compaction failed', cause))

  // A sweep every twenty seconds closes silent clients at their lastSeen; a
  // checkpoint every five minutes bounds what a crash can lose, and folds the
  // days that just left the raw window. Both are `unref`ed so a test process is
  // not kept alive by the plugin's timers.
  const sweep = setInterval(() => {
    void presence.sweep().catch(cause => console.error('personal-track: presence sweep failed', cause))
  }, 20_000)
  const checkpoint = setInterval(() => {
    void presence.checkpoint()
      .then(() => presence.maintain())
      .catch(cause => console.error('personal-track: presence checkpoint failed', cause))
  }, PRESENCE_CHECKPOINT_MS)
  sweep.unref()
  checkpoint.unref()
  // One disposer owns both the timers and the domain. The live prefix must be
  // written **before** the domain closes (a disposing storage domain rejects a
  // put), and cordis awaits this cleanup, so the flush is sequenced instead of
  // racing a separate domain-close effect — a race that dropped the last few
  // minutes of every open conversation on shutdown.
  ctx.effect(() => () => {
    clearInterval(sweep)
    clearInterval(checkpoint)
    return presence.close()
      .catch(cause => console.error('personal-track: presence flush failed', cause))
      .then(() => domain.close())
  }, 'personal-track: presence timers and domain close')

  const handler = createApiHandler({
    store: createHabitStore(domain, config),
    backup: createBackup(domain),
    presence,
    boundary,
    config,
    now,
  })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler,
  }), 'personal-track: /habit/api routes')
}
