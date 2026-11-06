/**
 * Where Baibao keeps its files.
 *
 * Everything else resolves storage through this module so the data root is
 * chosen in exactly one place: the `baibao-location.json` pointer next to the
 * DSH home, falling back to `<dshHome>/baibao`.
 */
import { constants } from 'node:fs'
import { access, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export function normalizePath(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.length > 0
    ? configured
    : path.join(os.homedir(), '.dsh')
}

export function defaultRoot() {
  return path.join(dshHome(), 'baibao')
}

export function locationFile() {
  return path.join(dshHome(), 'baibao-location.json')
}

export async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export async function pathWritable(target) {
  try {
    await access(target, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Current data root plus whether it came from the pointer file. */
export async function readLocation() {
  try {
    const raw = await readFile(locationFile(), 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed !== null && typeof parsed.root === 'string' && path.isAbsolute(parsed.root)) {
      return { root: path.resolve(parsed.root), configured: true }
    }
  } catch {
    // A missing or malformed pointer falls back to the default root.
  }
  return { root: defaultRoot(), configured: false }
}

export async function writeLocation(root) {
  await writeFile(
    locationFile(),
    JSON.stringify({ root, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  )
}

/** Absolute path of a file inside the current storage root. */
export async function rootFile(...segments) {
  const location = await readLocation()
  return path.join(location.root, ...segments)
}
