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
let presetsReady = null
let presetsResolve = null

const BAOBAO_PLUGINS = [
  {
    id: 'persona',
    name: '@deepseek-ai/dsh-persona',
    config: { prefix: PERSONA_TEXT, complete: false },
  },
  {
    id: 'tool-fs',
    name: '@deepseek-ai/dsh-tool-fs',
    config: { read: true, readImage: true, write: true, edit: true },
  },
  {
    id: 'compaction',
    name: 'cordis:group',
    group: true,
    isolate: { compaction: true },
    config: [
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
      { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
    ],
  },
  {
    id: 'terminal',
    name: 'cordis:group',
    group: true,
    isolate: { terminals: true },
    config: [
      { id: 'pty', name: '@deepseek-ai/dsh-terminal' },
      {
        id: 'terminal-shell',
        name: '@deepseek-ai/dsh-terminal-bash',
        config: {
          shellDialect: process.platform === 'win32' ? 'pwsh' : 'bash',
          timeoutMs: 300000,
        },
      },
      process.platform === 'win32'
        ? {
            id: 'persistent-shell',
            name: '@deepseek-ai/dsh-tool-pwsh-persistent',
            config: { timeoutMs: 300000 },
          }
        : {
            id: 'persistent-shell',
            name: '@deepseek-ai/dsh-tool-bash-persistent',
            config: { timeoutMs: 300000 },
          },
    ],
  },
]

async function ensureBaibaoPreset(presets) {
  if (presets === undefined) return false
  try {
    const list = await presets.list()
    if (list.some((preset) => preset.id === 'baibao')) return true
    await presets.register({
      id: 'baibao',
      name: '百宝',
      description: '百宝的默认 Agent 模式：长期助手人格、文件与终端工具。',
      order: 20,
      plugins: BAOBAO_PLUGINS,
    })
    return true
  } catch {
    return false
  }
}

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
    workspaceDir: path.join(defaultRoot(), 'workspace'),
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

const MEMORY_KINDS = new Set(['fact', 'preference', 'episode'])
let memoryQueue = Promise.resolve()

function withMemoryLock(task) {
  const next = memoryQueue.then(task, task)
  memoryQueue = next.then(
    () => {},
    () => {},
  )
  return next
}

async function memoryFile() {
  const location = await readLocation()
  return path.join(location.root, 'memory', 'memory.json')
}

async function readMemoryData() {
  try {
    const parsed = JSON.parse(await readFile(await memoryFile(), 'utf8'))
    if (parsed !== null && Array.isArray(parsed.entries)) {
      return { version: 1, entries: parsed.entries }
    }
  } catch {
    // A missing or malformed file starts empty.
  }
  return { version: 1, entries: [] }
}

async function writeMemoryData(data) {
  const file = await memoryFile()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

function normalizeMemoryInput(input) {
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (text === '' || text.length > 4000) throw new Error('invalid-memory-text')
  const kind = MEMORY_KINDS.has(input.kind) ? input.kind : 'fact'
  const tags = Array.isArray(input.tags)
    ? input.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').slice(0, 12)
    : []
  return { text, kind, tags }
}

function memoryTerms(query) {
  const raw = query.trim().toLowerCase()
  if (raw === '') return []
  const parts = raw.split(/[\s,，。.;；、/\\|:：()（）\[\]{}]+/).filter(Boolean)
  const terms = new Set()
  for (const part of parts) {
    if (/[\u3400-\u9fff]/.test(part)) {
      if (part.length <= 2) {
        terms.add(part)
      } else {
        for (let index = 0; index < part.length - 1; index += 1) {
          terms.add(part.slice(index, index + 2))
        }
      }
    } else if (part.length >= 2) {
      terms.add(part)
    }
  }
  if (terms.size === 0) terms.add(raw)
  return [...terms]
}

async function listMemory(query = '') {
  const data = await readMemoryData()
  const terms = memoryTerms(query)
  const entries = data.entries
    .filter((entry) => {
      if (terms.length === 0) return true
      const text = String(entry.text ?? '').toLowerCase()
      const tags = Array.isArray(entry.tags)
        ? entry.tags.map((tag) => String(tag).toLowerCase())
        : []
      return terms.some((term) => text.includes(term) || tags.some((tag) => tag.includes(term)))
    })
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
  return entries
}

async function saveMemory(input) {
  return withMemoryLock(async () => {
    const data = await readMemoryData()
    const normalized = normalizeMemoryInput(input)
    const fingerprint = normalizeMemoryText(normalized.text)
    const existing = data.entries.find(
      (entry) => normalizeMemoryText(entry.text) === fingerprint,
    )
    if (existing !== undefined) return existing
    const now = new Date().toISOString()
    const entry = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...normalized,
      createdAt: now,
      updatedAt: now,
    }
    data.entries.push(entry)
    await writeMemoryData(data)
    return entry
  })
}

async function deleteMemory(id) {
  return withMemoryLock(async () => {
    const data = await readMemoryData()
    const index = data.entries.findIndex((entry) => entry.id === id)
    if (index < 0) return false
    data.entries.splice(index, 1)
    await writeMemoryData(data)
    return true
  })
}

async function searchMemory(query, limit = 10) {
  const entries = await listMemory(query)
  return entries.slice(0, Math.max(1, Math.min(50, limit)))
}

function memoryTools() {
  return [
    {
      name: 'memory_save',
      description:
        'Save one durable fact, user preference, or episode about the user. Use only for information worth remembering across conversations.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The memory, written as a standalone sentence.' },
          kind: { type: 'string', enum: ['fact', 'preference', 'episode'] },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['text'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['id', 'text'],
          additionalProperties: false,
        },
        render: (value) => [{ type: 'text', text: `记得了：${value.text}` }],
      },
      execute: async (input) => {
        const entry = await saveMemory(input)
        return { id: entry.id, text: entry.text }
      },
    },
    {
      name: 'memory_search',
      description: 'Search Baibao long-term memory for facts, preferences, or episodes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (value) => [
          {
            type: 'text',
            text: typeof value === 'string' ? value : '没有找到相关记忆。',
          },
        ],
      },
      execute: async (input) => {
        const entries = await searchMemory(
          typeof input.query === 'string' ? input.query : '',
          typeof input.limit === 'number' ? input.limit : 10,
        )
        return entries.length === 0
          ? '没有找到相关记忆。'
          : entries.map((entry) => `- [${entry.kind}] ${entry.text}`).join('\n')
      },
    },
    {
      name: 'memory_forget',
      description: 'Delete one Baibao memory by id when the user asks to forget it.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: { deleted: { type: 'boolean' } },
          required: ['deleted'],
          additionalProperties: false,
        },
        render: (value) => [{ type: 'text', text: value.deleted ? '已删除。' : '没有找到该记忆。' }],
      },
      execute: async (input) => ({ deleted: await deleteMemory(input.id) }),
    },
  ]
}

function normalizeMemoryText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，。！？!?；;：:、,.()（）\[\]{}]/g, '')
}

function messageText(message) {
  if (typeof message?.text === 'string') return message.text
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
}

function extractMemoryCandidate(text) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (cleaned === '') return null
  const explicit = cleaned.match(
    /(?:记住|记一下|记下来|记下)[：:，,\s]*([^。！？!?\n]{4,160})/,
  )
  const preference = cleaned.match(
    /(我(?:喜欢|偏好|讨厌|不喜欢|希望|想要|习惯|总是|通常)[^。！？!?\n]{2,160})/,
  )
  const boundary = cleaned.match(/((?:不要|别)[^。！？!?\n]{2,160})/)
  const raw = (explicit?.[1] ?? preference?.[1] ?? boundary?.[1])?.trim()
  if (raw === undefined || raw.length < 4) return null
  const value = raw.replace(/[。！？!?]+$/, '').trim()
  const kind = /喜欢|偏好|讨厌|不喜欢|希望|想要|习惯|不要|别/.test(value)
    ? 'preference'
    : 'fact'
  return { text: value, kind, tags: ['auto'] }
}

const lastConsolidatedTurns = new Map()

async function consolidateAgent(ctx, agent) {
  const query = ctx.get('sessionQuery')
  if (query === undefined || baibaoWorkspacePath === null) return
  const cwd = agent.session?.header?.cwd
  if (typeof cwd !== 'string' || normalizePath(cwd) !== normalizePath(baibaoWorkspacePath)) {
    return
  }
  const surface = await query.readSurface(agent.id)
  const users = surface.events.filter((event) => event.type === 'user/message')
  const latest = users[users.length - 1]
  if (latest === undefined) return
  const candidate = extractMemoryCandidate(messageText(latest.data))
  if (candidate === null) return
  await saveMemory(candidate)
}

function renderMemoryContext(entries) {
  const lines = entries.slice(0, 12).map((entry) => {
    const text = String(entry.text ?? '').replace(/\s+/g, ' ').trim()
    const clipped = text.length > 180 ? `${text.slice(0, 179)}…` : text
    return `- [${entry.kind}] ${clipped}`
  })
  return [
    '以下是从百宝长期记忆里召回的条目，可能相关也可能过时。',
    '只在确实相关时使用；需要更多时调用 memory_search；不要向用户机械复述全部记忆。',
    ...lines,
  ].join('\n')
}

export function apply(ctx) {
  presetsReady = new Promise((resolve) => {
    presetsResolve = resolve
  })
  const presetTimer = setTimeout(() => {
    presetsResolve?.(false)
  }, 3000)
  ctx.inject(['agentPresets'], (presetCtx) => {
    void ensureBaibaoPreset(presetCtx.agentPresets)
      .then((ready) => {
        clearTimeout(presetTimer)
        presetsResolve?.(ready)
      })
      .catch(() => {
        clearTimeout(presetTimer)
        presetsResolve?.(false)
      })
  })
  void readLocation()
    .then(() => {
      baibaoWorkspacePath = path.join(defaultRoot(), 'workspace')
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
        const presets = ctx.get('agentPresets')
        void (async () => {
          let selected = presets?.composedPreset?.(agent.ctx) === 'baibao'
          if (!selected && typeof presets?.select === 'function') {
            try {
              await presets.select(agent, 'baibao')
              selected = true
            } catch {
              // Closed sessions or a missing preset keep their current composition.
            }
          }
          if (!selected) {
            try {
              agent.ctx.systemPrompt.section({
                name: 'baibao-persona',
                order: 50,
                text: PERSONA_TEXT,
              })
            } catch {
              // A resumed agent may already own the section in this scope.
            }
          }
          try {
            for (const tool of memoryTools()) {
              agent.ctx.tools.register(tool)
            }
          } catch {
            // A resumed agent may already own these tools in this scope.
          }
          const entries = await listMemory()
          if (entries.length > 0) {
            try {
              agent.ctx.systemPrompt.section({
                name: 'baibao-memory-context',
                order: 60,
                text: renderMemoryContext(entries),
              })
            } catch {
              // A resumed agent may already own the section in this scope.
            }
          }
          agent.ctx.effect(
            () =>
              agent.ctx.on('agent/turn-stopping', (payload) => {
                const previous = lastConsolidatedTurns.get(agent.id)
                if (previous === payload.turn) return
                lastConsolidatedTurns.set(agent.id, payload.turn)
                void consolidateAgent(ctx, agent).catch(() => {})
              }),
            'dsh-baibao: turn consolidation',
          )
        })().catch(() => {})
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
                baibaoWorkspacePath = path.join(defaultRoot(), 'workspace')
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
          path: '/dsh-baibao/api/memory',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                sendJson(response, 200, {
                  ok: true,
                  entries: await listMemory(url.searchParams.get('q') ?? ''),
                })
                return
              }

              if (request.method === 'POST') {
                const body = await readJson(request)
                const entry = await saveMemory(body)
                sendJson(response, 200, { ok: true, entry })
                return
              }

              if (request.method === 'DELETE') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                const id = url.searchParams.get('id')
                if (id === null || id === '') {
                  sendJson(response, 400, { ok: false, error: 'missing-memory-id' })
                  return
                }
                sendJson(response, 200, { ok: true, deleted: await deleteMemory(id) })
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
      'dsh-baibao: memory route',
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
              const workspaceDir = path.join(defaultRoot(), 'workspace')
              await mkdir(workspaceDir, { recursive: true })
              const workspace = await registry.create(workspaceDir, '百宝')
              baibaoWorkspacePath = workspace.path
              const presetReady = await presetsReady
              const preset = presetReady ? 'baibao' : undefined
              let created
              try {
                created = await controller.create({
                  cwd: workspace.path,
                  ...(preset === undefined ? {} : { agentPreset: preset }),
                })
              } catch {
                try {
                  created = await controller.create({
                    workspaceId: workspace.id,
                    ...(preset === undefined ? {} : { agentPreset: preset }),
                  })
                } catch {
                  created = await controller.create({ cwd: workspace.path })
                }
              }
              sendJson(response, 200, {
                ok: true,
                sessionId: created.sessionId,
                agentPreset: created.agentPreset ?? preset ?? null,
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
