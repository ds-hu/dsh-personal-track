/**
 * The plugin's route table: the one place `/habit/api` is declared.
 *
 * ADR 0001 chose a raw HTTP route over generated `ctx.remote`, which means the
 * JSON and the URL are the real interface between the two halves — and until
 * now each half spelled that interface out for itself, so the host's route
 * keys and the browser's fetch paths could drift with nothing to catch it. This
 * module is the single declaration: the host mounts a handler per entry, the
 * browser builds its requests from the same entries, and a test asserts the two
 * agree.
 *
 * It is isomorphic on purpose — plain data and one pure function, no `node:`
 * imports, no DOM — so the browser bundle can inline it.
 */

/** The path prefix this plugin owns on the GUI host. */
export const API_PREFIX = '/habit/api'

/**
 * The largest image either half will move, in raw bytes.
 *
 * The one wire constant besides the paths, and it lives here for the same
 * reason they do: the browser half refuses an oversized paste before it spends
 * the upload, and the host refuses it again at the boundary. Two copies of this
 * number would drift, and the drift would show up as an image that the picker
 * accepted and the store rejected.
 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** The verbs this API uses. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * One route: the verb, and the path relative to {@link API_PREFIX}.
 *
 * There is deliberately no `name` field — the table key already names the route,
 * and this module is inlined into the browser bundle, where a second copy of
 * every name is bytes for nothing.
 */
export interface RouteEntry {
  readonly method: HttpMethod
  /** Path within the prefix, beginning with `/`. */
  readonly request: string
}

/**
 * Every route the plugin serves.
 *
 * The key identifies the route on both sides: the host mounts one handler per
 * key, the browser builds its requests from the same entries, and a test asserts
 * the two agree. Note that `editCheck` and `check` share a path but differ in
 * verb — retiming a recorded check is genuinely a different operation from
 * recording a new one — so they are separate entries.
 */
export const routes = {
  clock: { method: 'GET', request: '/clock' },
  state: { method: 'GET', request: '/state' },
  check: { method: 'POST', request: '/check' },
  editCheck: { method: 'PATCH', request: '/check' },
  uncheck: { method: 'DELETE', request: '/check' },
  setMeal: { method: 'PUT', request: '/meal' },
  clearMeal: { method: 'DELETE', request: '/meal' },
  addSession: { method: 'POST', request: '/session' },
  patchSession: { method: 'PATCH', request: '/session' },
  removeSession: { method: 'DELETE', request: '/session' },
  setRun: { method: 'PUT', request: '/run' },
  clearRun: { method: 'DELETE', request: '/run' },
  setVocabTarget: { method: 'PUT', request: '/vocab-target' },
  laundryWash: { method: 'POST', request: '/laundry/wash' },
  laundryStock: { method: 'PATCH', request: '/laundry/stock' },
  exportBackup: { method: 'GET', request: '/backup' },
  importBackup: { method: 'POST', request: '/backup' },
  stats: { method: 'GET', request: '/stats' },
  addMedia: { method: 'POST', request: '/media' },
  patchMedia: { method: 'PATCH', request: '/media' },
  removeMedia: { method: 'DELETE', request: '/media' },
  addTask: { method: 'POST', request: '/tasks' },
  patchTask: { method: 'PATCH', request: '/tasks' },
  removeTask: { method: 'DELETE', request: '/tasks' },
  /**
   * The one route that answers with bytes rather than JSON: `<img src>` points
   * straight at it, so a long screenshot is decoded by the browser's image
   * pipeline and cached by URL instead of travelling through every state slice.
   */
  asset: { method: 'GET', request: '/asset' },
  addAsset: { method: 'POST', request: '/asset' },
  sweepAssets: { method: 'POST', request: '/asset/sweep' },
  addMaterial: { method: 'POST', request: '/material' },
  patchMaterial: { method: 'PATCH', request: '/material' },
  removeMaterial: { method: 'DELETE', request: '/material' },
  focusStart: { method: 'POST', request: '/focus' },
  focusEnd: { method: 'PATCH', request: '/focus' },
} as const satisfies Record<string, RouteEntry>

/** The identifier of one declared route. */
export type RouteName = keyof typeof routes

/** How the handler table is keyed: one entry per declared route. */
export type RouteHandlerTable = { readonly [K in RouteName]: unknown }

/**
 * The full path for one route, optionally with a query string.
 *
 * Query values that are `undefined` are left out entirely rather than sent as
 * the string `"undefined"`.
 *
 * @param name - a declared route.
 * @param params - query parameters, omitted when absent.
 * @returns the path, e.g. `/habit/api/state?date=2026-09-16`.
 */
export function urlOf(name: RouteName, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  const text = search.toString()
  return `${API_PREFIX}${routes[name].request}${text === '' ? '' : `?${text}`}`
}
