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
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const code = readFileSync('lib/client.js', 'utf8')

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
assert.equal(loaded.id, 'personal-track', 'browser module id must be the package name')
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

console.log('client bundle ✓  wrapper, exports, panel registration, injection face and styles verified')
