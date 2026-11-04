/**
 * Host (Node) half of dsh-baibao.
 *
 * The panel's storage setting is backed by one exact HTTP route. The route
 * resolves the data root (default `$DSH_HOME/baibao`), reports the memory and
 * config paths, and on save creates `memory/` + `config/` and persists the
 * chosen root beside the DSH home.
 *
 * The route is intentionally local-only for now; the plan records adding the
 * host connection gate before this ships outside a desktop profile.
 */
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-baibao'

const API = '/dsh-baibao/api/storage'

const PERSONA_TEXT = [
  '你是百宝，一个独立于其他对话的长期助手。',
  '说话简洁、直接、有温度；先给结论，再给依据；不谄媚，不堆砌。',
  '不确定就说不确定；不伪造能力、文件、命令或记忆。',
  '涉及删除、发布、支付等不可逆操作时，先确认再执行。',
].join('\n')

let baibaoWorkspacePath = null

function normalizePath(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function dshHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured.length > 0
    ? configured
    : path.join(os.homedir(), '.dsh')
}

function defaultRoot() {
  return path.join(dshHome(), 'baibao')
}

function locationFile() {
  return path.join(dshHome(), 'baibao-location.json')
}

async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

async function pathWritable(target) {
  try {
    await access(target, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function readLocation() {
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

async function describe(root, configured) {
  const exists = await pathExists(root)
  const writable = exists ? await pathWritable(root) : await pathWritable(path.dirname(root))
  return {
    root,
    defaultRoot: defaultRoot(),
    configured,
    memoryDir: path.join(root, 'memory'),
    configDir: path.join(root, 'config'),
    configFile: path.join(root, 'config', 'baibao.json'),
    exists,
    writable,
  }
}

async function readJson(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

async function createDefaults(root) {
  const memoryDir = path.join(root, 'memory')
  const configDir = path.join(root, 'config')
  await mkdir(root, { recursive: true })
  await mkdir(memoryDir, { recursive: true })
  await mkdir(configDir, { recursive: true })

  const memoryFile = path.join(memoryDir, 'memory.json')
  if (!(await pathExists(memoryFile))) {
    await writeFile(memoryFile, JSON.stringify({ version: 1, entries: [] }, null, 2) + '\n', 'utf8')
  }

  const configFile = path.join(configDir, 'baibao.json')
  if (!(await pathExists(configFile))) {
    await writeFile(
      configFile,
      JSON.stringify({ version: 1, createdAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    )
  }
}

async function writeLocation(root) {
  await writeFile(
    locationFile(),
    JSON.stringify({ root, updatedAt: new Date().toISOString() }, null, 2) + '\n',
    'utf8',
  )
}

function isInside(parent, child) {
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

async function migrateStorage(from, to) {
  const stats = { files: 0, backups: 0 }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await copyTree(path.join(from, 'memory'), path.join(to, 'memory'), stamp, stats)
  await copyTree(path.join(from, 'config'), path.join(to, 'config'), stamp, stats)
  await createDefaults(to)
  await writeLocation(to)

  let oldDeleted = false
  let oldDeleteError = null
  try {
    await rm(path.join(from, 'memory'), { recursive: true, force: true })
    await rm(path.join(from, 'config'), { recursive: true, force: true })
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

async function listBackups() {
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
  backups.sort((left, right) => String(right.createdAt ?? right.id).localeCompare(String(left.createdAt ?? left.id)))
  return backups
}

async function createBackup() {
  const location = await readLocation()
  if (!(await pathExists(location.root))) throw new Error('storage-missing')
  const id = new Date().toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupRoot(), id)
  const stats = { files: 0, backups: 0 }
  await copyTree(path.join(location.root, 'memory'), path.join(target, 'memory'), id, stats)
  await copyTree(path.join(location.root, 'config'), path.join(target, 'config'), id, stats)
  const manifest = {
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    source: location.root,
    files: stats.files,
  }
  await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return { id, path: target, createdAt: manifest.createdAt, files: stats.files }
}

async function deleteBackup(id) {
  if (!/^[0-9A-Za-z._-]+$/.test(id)) throw new Error('invalid-backup-id')
  const root = backupRoot()
  const target = path.join(root, id)
  if (!isInside(root, target)) throw new Error('invalid-backup-path')
  await rm(target, { recursive: true, force: true })
}

export function apply(ctx) {
  void readLocation()
    .then((location) => {
      baibaoWorkspacePath = path.join(location.root, 'workspace')
    })
    .catch(() => {})

  ctx.effect(
    () =>
      ctx.on('agent/created', (payload) => {
        const agent = payload.agent
        const cwd = agent.session?.header?.cwd
        if (
          baibaoWorkspacePath === null ||
          typeof cwd !== 'string' ||
          normalizePath(cwd) !== normalizePath(baibaoWorkspacePath) ||
          agent.ctx === undefined
        ) {
          return
        }
        try {
          agent.ctx.systemPrompt.section({
            name: 'baibao-persona',
            order: 50,
            text: PERSONA_TEXT,
          })
        } catch {
          // A resumed agent may already own the section in this scope.
        }
      }),
    'dsh-baibao: persona section',
  )

  ctx.inject(['webServer'], (hostCtx) => {
    const webServer = hostCtx.webServer

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: API,
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const location = await readLocation()
                sendJson(response, 200, {
                  ok: true,
                  storage: await describe(location.root, location.configured),
                })
                return
              }

              if (request.method === 'POST') {
                const body = await readJson(request)
                const raw = body !== null && typeof body.root === 'string' ? body.root.trim() : ''
                if (raw === '' || !path.isAbsolute(raw)) {
                  sendJson(response, 400, { ok: false, error: 'invalid-path' })
                  return
                }
                const root = path.resolve(raw)
                if (path.parse(root).root === root) {
                  sendJson(response, 400, { ok: false, error: 'filesystem-root' })
                  return
                }
                const previous = await readLocation()
                if (
                  previous.root !== root &&
                  (isInside(previous.root, root) || isInside(root, previous.root))
                ) {
                  sendJson(response, 400, { ok: false, error: 'nested-path' })
                  return
                }
                let migration = null
                const shouldMigrate = body.migrate !== false
                if (
                  shouldMigrate &&
                  previous.root !== root &&
                  ((await pathExists(previous.root)) || previous.configured)
                ) {
                  migration = await migrateStorage(previous.root, root)
                } else {
                  await createDefaults(root)
                  await writeLocation(root)
                }
                baibaoWorkspacePath = path.join(root, 'workspace')
                sendJson(response, 200, {
                  ok: true,
                  storage: await describe(root, true),
                  migration,
                })
                return
              }

              response.writeHead(405, { allow: 'GET, POST' })
              response.end()
            } catch (error) {
              sendJson(response, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        }),
      'dsh-baibao: storage route',
    )

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/storage/backups',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                sendJson(response, 200, { ok: true, backups: await listBackups() })
                return
              }

              if (request.method === 'POST') {
                const backup = await createBackup()
                sendJson(response, 200, {
                  ok: true,
                  backup,
                  backups: await listBackups(),
                })
                return
              }

              if (request.method === 'DELETE') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                const id = url.searchParams.get('id')
                if (id === null || id === '') {
                  sendJson(response, 400, { ok: false, error: 'missing-backup-id' })
                  return
                }
                await deleteBackup(id)
                sendJson(response, 200, { ok: true, backups: await listBackups() })
                return
              }

              response.writeHead(405, { allow: 'GET, POST, DELETE' })
              response.end()
            } catch (error) {
              sendJson(response, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        }),
      'dsh-baibao: storage backups route',
    )

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/chat/start',
          handler: async (request, response) => {
            if (request.method !== 'POST') {
              response.writeHead(405, { allow: 'POST' })
              response.end()
              return
            }
            const registry = ctx.get('workspaceRegistry')
            const controller = ctx.get('sessionController')
            if (registry === undefined || controller === undefined) {
              sendJson(response, 503, { ok: false, error: 'workspace-unavailable' })
              return
            }
            try {
              const location = await readLocation()
              const workspaceDir = path.join(location.root, 'workspace')
              await mkdir(workspaceDir, { recursive: true })
              const workspace = await registry.create(workspaceDir, '百宝')
              baibaoWorkspacePath = workspace.path
              let created
              try {
                created = await controller.create({ cwd: workspace.path })
              } catch {
                created = await controller.create({ workspaceId: workspace.id })
              }
              sendJson(response, 200, {
                ok: true,
                sessionId: created.sessionId,
                workspace: {
                  id: workspace.id,
                  path: workspace.path,
                  title: workspace.title,
                },
              })
            } catch (error) {
              sendJson(response, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        }),
      'dsh-baibao: chat start route',
    )
  })
}
