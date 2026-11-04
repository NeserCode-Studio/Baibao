/**
 * Build the browser half of dsh-baibao.
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
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'

const PACKAGE_NAME = 'dsh-baibao'
const ENTRY = 'src/client/index.tsx'

const EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const result = await build({
  entryPoints: [ENTRY],
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
if (clientBundle === undefined) throw new Error('esbuild produced no output for ' + ENTRY)

// esbuild opens every CJS file with its own strict-mode directive; the banner
// above already supplies one inside the factory, so drop the duplicate.
const body = clientBundle.text.replace(/^"use strict";\r?\n/, '')

await mkdir('lib', { recursive: true })
await writeFile('lib/client.js', body, 'utf8')
await copyFile('src/index.js', 'lib/index.js')

const bytes = Buffer.byteLength(body, 'utf8')
console.log(`lib/client.js  ${(bytes / 1024).toFixed(1)} KiB`)
console.log('lib/index.js   copied from src/index.js')
