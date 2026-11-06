/**
 * Storage root: layout, migration between roots, and backups.
 *
 * A change of root copies `memory/`, `config/` and `push/`, then deletes the
 * old copies. Backups live under `<defaultRoot>/backups` regardless of where
 * the data currently is, so they survive a root change.
 */
import { copyFile, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { defaultRoot, pathExists, pathWritable, readLocation, writeLocation } from './paths.js'

export async function describe(root, configured) {
  const exists = await pathExists(root)
  const writable = exists ? await pathWritable(root) : await pathWritable(path.dirname(root))
  return {
    root,
    defaultRoot: defaultRoot(),
    configured,
    memoryDir: path.join(root, 'memory'),
    configDir: path.join(root, 'config'),
    workspaceDir: path.join(defaultRoot(), 'workspace'),
    configFile: path.join(root, 'config', 'baibao.json'),
    exists,
    writable,
  }
}

const DATA_DIRS = ['memory', 'config', 'push']

/** Create the directory layout and any missing default files. */
export async function createDefaults(root) {
  await mkdir(root, { recursive: true })
  for (const name of DATA_DIRS) {
    await mkdir(path.join(root, name), { recursive: true })
  }

  const memoryFile = path.join(root, 'memory', 'memory.json')
  if (!(await pathExists(memoryFile))) {
    await writeFile(memoryFile, JSON.stringify({ version: 1, entries: [] }, null, 2) + '\n', 'utf8')
  }

  const notificationsFile = path.join(root, 'push', 'notifications.json')
  if (!(await pathExists(notificationsFile))) {
    await writeFile(
      notificationsFile,
      JSON.stringify({ version: 1, notifications: [] }, null, 2) + '\n',
      'utf8',
    )
  }

  const configFile = path.join(root, 'config', 'baibao.json')
  if (!(await pathExists(configFile))) {
    await writeFile(
      configFile,
      JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    )
  }
}

export function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function copyTree(source, destination, stamp, stats) {
  if (!(await pathExists(source))) return
  await mkdir(destination, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      await copyTree(from, to, stamp, stats)
      continue
    }
    if (!entry.isFile()) continue
    if (await pathExists(to)) {
      await rename(to, `${to}.bak-${stamp}`)
      stats.backups += 1
    }
    await copyFile(from, to)
    stats.files += 1
  }
}

export async function migrateStorage(from, to) {
  const stats = { files: 0, backups: 0 }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const name of DATA_DIRS) {
    await copyTree(path.join(from, name), path.join(to, name), stamp, stats)
  }
  await createDefaults(to)
  await writeLocation(to)

  let oldDeleted = false
  let oldDeleteError = null
  try {
    for (const name of DATA_DIRS) {
      await rm(path.join(from, name), { recursive: true, force: true })
    }
    oldDeleted = true
    try {
      await rmdir(from)
    } catch {
      // The old root may still hold backups or unrelated files.
    }
  } catch (error) {
    oldDeleteError = error instanceof Error ? error.message : String(error)
  }

  return {
    from,
    to,
    files: stats.files,
    backups: stats.backups,
    oldDeleted,
    oldDeleteError,
  }
}

function backupRoot() {
  return path.join(defaultRoot(), 'backups')
}

export async function listBackups() {
  const root = backupRoot()
  if (!(await pathExists(root))) return []
  const entries = await readdir(root, { withFileTypes: true })
  const backups = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const target = path.join(root, entry.name)
    let manifest = null
    try {
      manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'))
    } catch {
      // A hand-copied directory without a manifest is still listable.
    }
    backups.push({
      id: entry.name,
      path: target,
      createdAt: typeof manifest?.createdAt === 'string' ? manifest.createdAt : null,
      files: typeof manifest?.files === 'number' ? manifest.files : null,
    })
  }
  backups.sort((left, right) =>
    String(right.createdAt ?? right.id).localeCompare(String(left.createdAt ?? left.id)),
  )
  return backups
}

export async function createBackup() {
  const location = await readLocation()
  if (!(await pathExists(location.root))) throw new Error('storage-missing')
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupRoot(), id)
  const stats = { files: 0, backups: 0 }
  for (const name of DATA_DIRS) {
    await copyTree(path.join(location.root, name), path.join(target, name), id, stats)
  }
  const manifest = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    source: location.root,
    files: stats.files,
  }
  await writeFile(
    path.join(target, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  )
  return { id, path: target, createdAt: manifest.createdAt, files: stats.files }
}

export async function deleteBackup(id) {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) throw new Error('invalid-backup-id')
  const root = backupRoot()
  const target = path.join(root, id)
  if (!isInside(root, target)) throw new Error('invalid-backup-path')
  await rm(target, { recursive: true, force: true })
}
