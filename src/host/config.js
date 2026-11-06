/**
 * Read/write `<storageRoot>/config/baibao.json`.
 *
 * This file holds user-editable state only (persona tuning, consolidation
 * model). It is deliberately separate from the profile patch layer: rewriting
 * YAML is not a good fit for values the user edits in the panel.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readLocation } from './paths.js'

export async function configFile() {
  const location = await readLocation()
  return path.join(location.root, 'config', 'baibao.json')
}

export async function readConfigData() {
  try {
    const parsed = JSON.parse(await readFile(await configFile(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object') return parsed
  } catch {
    // Missing or malformed config starts from defaults.
  }
  return { version: 1 }
}

export async function writeConfigData(data) {
  const file = await configFile()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}
