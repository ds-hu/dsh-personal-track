/**
 * Build both halves of the personal-track plugin.
 *
 * Host half   → `lib/index.js`  (ESM, node, every bare import external)
 * Client half → `lib/client.js` (CJS closure-factory, inlined except the
 *   frozen platform module table — see docs/adr/0001-out-of-tree-transport.md)
 *
 * Why the native CLI instead of esbuild's JS API: the JS API talks to the
 * compiler through a piped child process, which the DSH file sandbox rejects
 * (`spawn EPERM`). The CLI *is* the compiler, so invoking it with inherited
 * stdio needs no piped spawn at all.
 *
 * The client wrapper is the module-loader contract the Web shell expects; its
 * shape is copied verbatim from the in-repo reference bundle
 * (`apps/web/tests/fixtures/plugins/fixture-live-client/`).
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Browser module id: the manifest's package name, which is what
 * `client-modules` keys the module graph by. Read from package.json rather
 * than repeated here, so a rename cannot leave the bundle registered under the
 * old id (the shell then simply never finds it).
 */
const ID = JSON.parse(readFileSync('package.json', 'utf8')).name

/** Module specifiers the shell shares into its frozen module table. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/** esbuild platform package for the running platform/arch. */
function platformPackage() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'win32') return `win32-${arch}`
  if (process.platform === 'darwin') return `darwin-${arch}`
  return `linux-${arch}`
}

/** Absolute path of the native esbuild executable. */
function esbuildBinary() {
  const pkg = platformPackage()
  const exe = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'

  const hoisted = join('node_modules', '@esbuild', pkg, exe)
  if (existsSync(hoisted)) return hoisted

  const store = join('node_modules', '.pnpm')
  const prefix = `@esbuild+${pkg}@`
  for (const entry of readdirSync(store)) {
    if (!entry.startsWith(prefix)) continue
    const candidate = join(store, entry, 'node_modules', '@esbuild', pkg, exe)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`cannot locate the esbuild binary for ${pkg}; run \`pnpm install\` first`)
}

const binary = esbuildBinary()

const hostArgs = [
  'src/host/index.ts',
  '--bundle',
  '--format=esm',
  '--platform=node',
  '--target=es2024',
  '--packages=external',
  '--outfile=lib/index.js',
  '--sourcemap',
  '--log-level=info',
  '--legal-comments=none',
]

const clientArgs = [
  'src/client/index.tsx',
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2020',
  '--jsx=automatic',
  '--outfile=lib/client.js',
  '--sourcemap',
  '--log-level=info',
  '--legal-comments=none',
  ...PLATFORM_MODULES.map(module => `--external:${module}`),
  `--banner:js=window.__ModuleLoader__.load({ id: "${ID}", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  '--footer:js=return module.exports; } });',
]

rmSync('lib', { recursive: true, force: true })

if (process.argv.includes('--watch')) {
  const children = [hostArgs, clientArgs].map(args => spawn(binary, [...args, '--watch'], {
    stdio: 'inherit',
  }))
  const stop = () => {
    for (const child of children) child.kill()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  console.log('watching src/host and src/client …')
} else {
  for (const args of [hostArgs, clientArgs]) {
    const result = spawnSync(binary, args, { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
