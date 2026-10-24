/**
 * Verify the built browser half the way the Web shell loads it.
 *
 * Loads `lib/client.js`, plays the module-loader facade, materializes the
 * closure factory with the frozen platform `require` table, then drives the
 * exported `apply` against a recording context. This proves the bundle's
 * contract — wrapper, exports, panel registration, injection face, style
 * injection — without a browser; React's actual mounting is the GUI's job.
 */
import { strict as assert } from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, isAbsolute, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const code = readFileSync('lib/client.js', 'utf8')
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))

/** What the facade captured. */
let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      loaded = spec
    },
  },
}

/** The bare minimum DOM the board's style injection touches. */
const appended = []
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: '' }),
  head: {
    append(node) {
      appended.push(node)
    },
  },
}

// The bundle is a script, exactly as the shell runs it.
new Function(code)()

assert.ok(loaded, 'the bundle must call window.__ModuleLoader__.load')
// The graph is keyed by the manifest's package name — `client-modules` reads it
// from package.json, not from the Loader row — so the id inside the bundle has
// to be that same string. Compared against the manifest, never a literal: a
// rename that updated one and not the other is exactly the failure this guards.
assert.equal(loaded.id, manifest.name, 'browser module id must be the package name')
assert.equal(typeof loaded.factory, 'function', 'the facade receives a factory')

const exports_ = loaded.factory(require)

assert.equal(typeof exports_.apply, 'function', 'the client half exports apply')

// One service: the panel and its sidebar entry are both slot registrations, so
// the two shells this plugin used to reach into are down to one.
assert.deepEqual(exports_.inject, ['slots'], 'client half injects exactly the services it touches')

const seen = { slotRegistrations: [], effects: 0 }

const ctx = {
  effect(fn) {
    seen.effects += 1
    return fn() ?? (() => {})
  },
  slots: {
    inject(_name, callback) {
      callback()
      return () => {}
    },
    register(spec, component) {
      seen.slotRegistrations.push({ spec, component })
      return () => {}
    },
  },
}

// Guard the context the way cordis does: a service prop resolves only when the
// plugin declared it in `inject`, otherwise the proxy throws. A plain fake
// object hides undeclared-service bugs.
const guardedCtx = new Proxy(ctx, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined
    if (prop === 'effect' || exports_.inject.includes(prop)) return ctx[prop]
    throw new Error(`cannot get property "${prop}" without inject`)
  },
})

exports_.apply(guardedCtx)

assert.equal(seen.effects, 2, 'apply registers two effects (the panel and the sidebar entry)')
assert.equal(appended.length, 1, 'apply injects the stylesheet exactly once')

const registrationFor = name => seen.slotRegistrations.find(entry => entry.spec.name === name)

const main = registrationFor('main')
assert.ok(main, 'a main-area panel is registered')
assert.equal(main.spec.key, 'personal-track-board')
assert.equal(typeof main.component, 'function', 'the panel is a component')

// The panel receives its commands through the registration's injection face.
assert.equal(typeof main.spec.inject, 'function', 'the panel declares an injection face')
const face = main.spec.inject()
for (const method of [
  'clock', 'state', 'check', 'uncheck', 'editCheck', 'setMeal', 'clearMeal', 'setStock', 'wash',
  'addSession', 'patchSession', 'removeSession', 'setVocabTarget', 'setRun', 'clearRun',
  'addMedia', 'patchMedia', 'removeMedia', 'addTask', 'patchTask', 'removeTask', 'stats',
  'exportAll', 'importAll',
  // materials and focus mode
  'assetUrl', 'addImageMaterial', 'addTextMaterial', 'patchTextMaterial', 'removeMaterial',
  'sweepAssets', 'startFocus', 'endFocus',
]) {
  assert.equal(typeof face.client[method], 'function', `the face exposes ${method}()`)
}

// The one method that is not a request: it builds the URL an `<img>` points at.
assert.equal(typeof face.client.assetUrl('abc'), 'string', 'assetUrl builds a URL')
assert.match(face.client.assetUrl('abc'), /\/habit\/api\/asset\?id=abc$/, 'assetUrl addresses the asset route')

const panellist = registrationFor('sidebar.panellist')
assert.ok(panellist, 'a sidebar panel entry is registered')
assert.equal(panellist.spec.id, 'personal-track-board')
assert.equal(panellist.spec.label(), '习惯看板')
assert.equal(typeof panellist.component, 'function', 'the sidebar entry has an icon component')

// The sidebar glyph is hand-drawn inline SVG, and a hook-free one can really be
// rendered in Node — which is what proves it is an svg and honours its size.
const glyph = panellist.component({ size: 18 })
assert.equal(glyph.type, 'svg', 'the sidebar glyph renders an svg')
assert.equal(glyph.props.width, 18, 'the glyph honours the size it is handed')

// --- stylesheet guards -------------------------------------------------------
//
// Neither the type checker nor a render-free test can notice a lost scroll
// region, so the CSS itself is asserted.
//
// The main-area panel: the shell's centre column clips its overflow and scrolls
// nothing itself, so an occupant that does not scroll itself silently loses
// everything below the fold.
//
// The board and the statistics panel are now the two inner scroll regions — one
// per view — and each is a flex item of a box already exactly as tall as the
// panel. min-height:0 is the load-bearing part: a flex item's automatic minimum
// size is its content, so without it the inner scroller refuses to shrink and
// simply overflows the clipping column, where overflow-y:auto never engages.
const css = String(appended[0].textContent)
// Comments mention these very properties and would otherwise join a selector.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
const bodiesFor = selector => [...bare.matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .filter(([, list]) => list.split(',').map(part => part.trim()).includes(selector))
  .map(([, , body]) => body)
const scrollsItself = body => /overflow-y:\s*auto/.test(body) && /min-height:\s*0/.test(body)
for (const selector of ['.pt-panel', '.pt-board']) {
  const bodies = bodiesFor(selector)
  assert.ok(bodies.length > 0, `the stylesheet declares ${selector}`)
  assert.ok(scrollsItself(bodies), `${selector} scrolls itself (overflow-y:auto plus min-height:0)`)
}

// Focus mode covers the viewport and keeps its own scroll region for materials.
const focusBodies = bodiesFor('.pt-fo')
assert.ok(focusBodies.length > 0, 'the stylesheet declares .pt-fo')
assert.ok(
  focusBodies.some(body => /position:\s*fixed/.test(body) && /inset:\s*0/.test(body)),
  '.pt-fo is a fixed, full-viewport overlay',
)
const materialBodies = bodiesFor('.pt-fo-materials')
assert.ok(materialBodies.length > 0, 'the stylesheet declares .pt-fo-materials')
assert.ok(materialBodies.some(body => /overflow-y:\s*auto/.test(body)), '.pt-fo-materials scrolls the material stream')

// Focus mode is opaque, and it takes its colours from the shell's own theme
// tokens rather than a palette of its own. Translucency was the bug: the board
// behind the overlay stayed legible through the whole screen. The demo hid the
// same mistake because its page was the same dark colour the overlay tinted to.
//
// The surface must be a token with an opaque literal fallback, so a shell that
// renames one still paints an opaque screen in the right polarity.
const overlayBodies = [...bodiesFor('.pt-fo'), ...bodiesFor('body[data-ds-dark-theme] .pt-fo')]
const surfaces = overlayBodies
  .flatMap(body => [...body.matchAll(/--pt-fo-bg\s*:\s*([^;]+)/g)].map(([, value]) => value.trim()))
assert.equal(surfaces.length, 2, 'both shell themes define the overlay surface colour')
for (const value of surfaces) {
  assert.ok(
    /^var\(--dsw-alias-bg-base,\s*#[0-9a-f]{3,8}\)$/i.test(value),
    `the overlay surface is a shell token with an opaque literal fallback (${value})`,
  )
}
assert.ok(
  overlayBodies.some(body => /background:\s*var\(--pt-fo-bg\)/.test(body)),
  '.pt-fo paints that opaque surface',
)

// Colour follows the shell's signal, never the OS preference. The two disagree
// on any machine whose shell theme is not its system theme, and the overlay then
// paints the wrong polarity — the literals above are a token fallback, not a
// second opinion about which theme is on.
assert.ok(
  !/prefers-color-scheme/.test(bare),
  'the stylesheet reads the shell theme signal, not the OS preference',
)

// The phone toolbar sticks over the material stream, so it has to be opaque too
// — and, having become opaque, it needs the hairline the desktop toolbar gets
// away without.
const toolbarBodies = bodiesFor('.pt-fo-toolbar')
const stickyBodies = toolbarBodies.filter(body => /position:\s*sticky/.test(body))
assert.equal(stickyBodies.length, 1, 'the toolbar sticks on a phone')
assert.ok(/background:\s*var\(--pt-fo-bg\)/.test(stickyBodies[0]), 'the sticky toolbar is opaque')
assert.ok(
  /border-bottom:\s*1px solid var\(--pt-line\)/.test(stickyBodies[0]),
  'the sticky toolbar is closed off with a line',
)

// A `width:100%` box that also carries padding or a horizontal border is wider
// than the column it sits in unless it is border-box. Nothing sets that
// globally: the shell resets border-box per component (its stylesheet has no
// universal selector) and this project's demo does have a global reset — which
// is exactly why the notes box painted across the overlay's divider in the real
// plugin while looking right in the demo. The shape is asserted, so it cannot
// come back through some other box.
for (const [, selectorList, body] of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  if (!/width:\s*100%/.test(body)) continue
  const padded = /(?:^|;)\s*padding(?:-(?:left|right|inline(?:-start|-end)?))?\s*:\s*[^;]*[1-9]/.test(body)
  const bordered = /(?:^|;)\s*border(?:-(?:left|right))?\s*:\s*[^;]*[1-9]/.test(body)
  if (!padded && !bordered) continue
  assert.ok(
    /box-sizing:\s*border-box/.test(body),
    `${selectorList.trim()} is width:100% with padding or a border, so it must be box-sizing:border-box`,
  )
}

// The one structural line inside the overlay is the split between its columns,
// so it is drawn in the heavy weight while the cards keep the light one — on the
// desktop as a vertical rule, on a phone as a horizontal one. Both halves are
// asserted: checking only the desktop rule left the phone one faint and green.
const splitBodies = bodiesFor('.pt-fo-left')
assert.ok(
  splitBodies.some(body => /border-right:\s*1px solid var\(--pt-line-strong\)/.test(body)),
  'the overlay column split is drawn in the heavy line',
)
assert.ok(
  splitBodies.some(body => /border-bottom:\s*1px solid var\(--pt-line-strong\)/.test(body)),
  'the overlay column split is drawn in the heavy line on a phone too',
)
for (const body of splitBodies) {
  assert.ok(
    !/(?:border-right|border-bottom):\s*1px solid var\(--pt-line\)/.test(body),
    'the split never drops back to the light line',
  )
}

// On a phone the focus column only pushes the board down: focus mode is one tap
// away from any row, so the column is dropped rather than stacked. Asserting the
// exact block keeps it a deliberate rule instead of a stray `display:none`.
assert.ok(
  /@media\s*\(max-width:\s*720px\)\s*\{\s*\.pt-focus-col\s*\{\s*display:\s*none;?\s*\}\s*\}/.test(bare),
  'the focus column is dropped on a phone rather than stacked above the board',
)

// Focus mode has to close its session when the page goes away. A refresh is a
// real end of the session, and a session left open is discarded by the store at
// the next start — so the visit's time is lost. No type checker and no
// render-free test can see a browser event listener, so, like the stylesheet
// guards above, the shape itself is asserted on the built bundle.
assert.match(
  code,
  /addEventListener\("pagehide"/,
  'the client closes the focus session when the page is unloaded',
)

// --- the manifest the Plugins page reads -------------------------------------
//
// The shell draws a plugin's card, detail page and component rows from the
// manifest alone, without evaluating plugin code: it resolves
// `<package>/package.json` through the ESM resolver, then reads `icon` as a
// manifest-relative SVG/PNG/JPEG/WebP of at most 256 KiB inside the manifest
// directory and inlines it as a data URI. Every one of those is a way for the
// picture to disappear while the file sits right there in the checkout, so the
// pair is asserted here instead of being eyeballed in the GUI.
const ICON_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

// The manifest is only reachable through the export map: without it the shell's
// resolver throws ERR_PACKAGE_PATH_NOT_EXPORTED and the plugin keeps the default
// artwork.
assert.equal(
  manifest.exports['./package.json'],
  './package.json',
  'the shell resolves <package>/package.json, so the manifest must stay exported',
)
assert.equal(manifest.dsh.client.platform, 'web', 'the package declares its browser half')
// The shell reads `exports["./client"]` (string form) and serves that file; this
// file loads `lib/client.js` as the bundle. They are the same file or the
// verified bundle is not the one the GUI runs.
assert.equal(typeof manifest.exports['./client'], 'string', 'the browser half is exported as a plain string path')
assert.equal(
  resolve(manifest.exports['./client']),
  resolve('lib/client.js'),
  'the exported browser half is the bundle verified here',
)

const icon = manifest.icon
assert.equal(typeof icon, 'string', 'the manifest declares the icon the Plugins page draws')
assert.ok(
  !isAbsolute(icon) && !/^[A-Za-z][A-Za-z\d+.-]*:/.test(icon),
  `the icon is a manifest-relative path (${icon})`,
)
assert.ok(ICON_TYPES.has(extname(icon).toLowerCase()), `the icon is SVG, PNG, JPEG or WebP (${icon})`)

const iconBytes = readFileSync(icon)
assert.ok(iconBytes.length <= 256 * 1024, 'the icon is within the 256 KiB the shell admits')
// An icon that is not in `files` resolves in a checkout and vanishes on install.
assert.ok(
  manifest.files.includes(icon.replace(/^\.\//, '')),
  'the icon is listed in `files`, so an install carries it',
)
// The declared type comes from the extension alone, so the bytes have to match
// it — a JSON or HTML file named `.svg` would be inlined as an unrenderable image.
if (extname(icon).toLowerCase() === '.svg') {
  assert.match(iconBytes.toString('utf8'), /^<svg[\s>]/, 'the icon really is an SVG document')
}

// The card's title and one-liner come from `locale/<language>.json`, and the
// shell's reader is strict in two directions that a checkout cannot show:
// it scans the *whole* locale directory once `en.json` resolves, and refuses the
// entire directory if any file's name is not a language id or two names differ
// only in case. Both make the card fall back to the package name, so the names
// and the entries are asserted rather than assumed.
const LANGUAGES = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u
assert.equal(
  manifest.exports['./locale/*.json'],
  './locale/*.json',
  'locale files resolve through the export map; without it the card has no local text',
)
assert.ok(manifest.files.includes('locale/*.json'), 'the locale files are listed in `files`')

const localeFiles = readdirSync('locale').filter(name => name.endsWith('.json'))
assert.ok(localeFiles.includes('en.json'), 'en.json is the file the shell resolves first')
const languages = new Set()
for (const name of localeFiles) {
  const language = name.slice(0, -'.json'.length)
  assert.match(language, LANGUAGES, `${name} is named for a language id`)
  assert.ok(!languages.has(language.toLowerCase()), `${name} does not duplicate a language`)
  languages.add(language.toLowerCase())
  const meta = JSON.parse(readFileSync(resolve('locale', name), 'utf8')).meta
  assert.equal(typeof meta?.title, 'string', `${name} declares meta.title`)
  assert.equal(typeof meta?.description, 'string', `${name} declares meta.description`)
  assert.ok(meta.title.trim() !== '' && meta.description.trim() !== '', `${name} carries non-empty text`)
}

console.log('client bundle ✓  wrapper, exports, panel registration, injection face and styles verified')
console.log(
  `plugin metadata ✓  ${manifest.name} — manifest reachable, icon ${icon} ships and is admissible,`
  + ` ${localeFiles.length} locale file(s) present`,
)
