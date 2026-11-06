/**
 * Build the browser half of dsh-baibao, and optionally watch it.
 *
 * The client module system only accepts bundles that register themselves
 * through `window.__ModuleLoader__.load({ id, factory })`, where the factory
 * owns the whole module body and receives the module-table `require`. esbuild
 * emits an ordinary CJS module (`module.exports = ...`), so this script wraps
 * that output in the loader envelope and fixes the registration id to the
 * package name — the graph row and the registration key must match, or the
 * browser never materializes the plugin.
 *
 * `react`, `react/jsx-runtime` and the ui-primitives package are externals: the
 * host's platform module table supplies them, and a bundled copy would break
 * hook identity against the shell's React instance.
 *
 * `--watch` keeps the process alive and rebuilds after `src/` changes. DSH's
 * client HMR watches the emitted `lib/client.js` and swaps the module without a
 * page refresh; unchanged output is not rewritten, so a no-op save cannot
 * trigger a pointless reload.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { build } from 'esbuild'

const PACKAGE_NAME = 'dsh-baibao'
const CLIENT_ENTRY = 'src/client/index.tsx'
const HOST_ENTRY = 'src/index.js'
const CLIENT_OUT = 'lib/client.js'
const HOST_OUT = 'lib/index.js'
const WATCH = process.argv.includes('--watch')

const EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/**
 * Write a generated file only when its bytes actually changed.
 * @param {string} path - output path.
 * @param {string} content - complete file content.
 * @returns {Promise<boolean>} whether the file was rewritten.
 */
async function writeIfChanged(path, content) {
  try {
    const current = await readFile(path, 'utf8')
    if (current === content) return false
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await writeFile(path, content, 'utf8')
  return true
}

/**
 * Bundle the host half.
 *
 * The host is Node ESM and used to be a single self-contained file, so the
 * build simply copied it. Now that it imports `./host/*`, the copy would leave
 * those relative imports pointing at files that do not exist under `lib/`.
 *
 * `packages: 'external'` keeps `node:*` and any bare package specifier out of
 * the bundle — the host runtime supplies those — while relative modules are
 * inlined.
 */
async function buildHost() {
  const result = await build({
    entryPoints: [HOST_ENTRY],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    packages: 'external',
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8',
  })
  const [hostBundle] = result.outputFiles
  if (hostBundle === undefined) throw new Error('esbuild produced no output for ' + HOST_ENTRY)
  return hostBundle.text
}

/**
 * Run one complete client + host build.
 * @returns {Promise<boolean>} whether any output changed.
 */
async function buildOnce() {
  const result = await build({
    entryPoints: [CLIENT_ENTRY],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    external: EXTERNALS,
    loader: { '.css': 'text' },
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8',
    banner: {
      js: [
        `window.__ModuleLoader__.load({`,
        `\tid: ${JSON.stringify(PACKAGE_NAME)},`,
        `\tfactory: (require) => {`,
        // The factory body is CJS: `module`/`exports` must exist before it runs,
        // and the strict-mode directive has to open the function to take effect.
        `\t\t"use strict";`,
        `\t\tvar module = { exports: {} };`,
        `\t\tvar exports = module.exports;`,
      ].join('\n'),
    },
    footer: {
      js: ['\t\treturn module.exports;', '\t}', '});', ''].join('\n'),
    },
  })

  const [clientBundle] = result.outputFiles
  if (clientBundle === undefined) throw new Error('esbuild produced no output for ' + CLIENT_ENTRY)

  // esbuild opens every CJS file with its own strict-mode directive; the banner
  // above already supplies one inside the factory, so drop the duplicate.
  const body = clientBundle.text.replace(/^"use strict";\r?\n/, '')

  await mkdir('lib', { recursive: true })
  const clientChanged = await writeIfChanged(CLIENT_OUT, body)
  const hostSource = await buildHost()
  const hostChanged = await writeIfChanged(HOST_OUT, hostSource)

  const bytes = Buffer.byteLength(body, 'utf8')
  const hostBytes = Buffer.byteLength(hostSource, 'utf8')
  console.log(
    `${CLIENT_OUT}  ${(bytes / 1024).toFixed(1)} KiB${clientChanged ? '' : '  (unchanged)'}`,
  )
  console.log(
    `${HOST_OUT}   ${(hostBytes / 1024).toFixed(1)} KiB${hostChanged ? '' : '  (unchanged)'}`,
  )
  return clientChanged || hostChanged
}

if (!WATCH) console.log('[baibao] building once')
await buildOnce()

if (WATCH) {
  let timer
  let building = false
  let queued = false

  const run = async () => {
    if (building) {
      queued = true
      return
    }
    building = true
    try {
      await buildOnce()
    } catch (error) {
      console.error('[baibao] build failed:', error instanceof Error ? error.message : error)
    } finally {
      building = false
    }
    if (queued) {
      queued = false
      schedule()
    }
  }

  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void run(), 80)
  }

  const watcher = watch('src', { recursive: true }, schedule)
  console.log('[baibao] watching src/ (Ctrl+C to stop)')
  process.on('SIGINT', () => {
    watcher.close()
    process.exit(0)
  })
}
