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

const DEFAULT_PERSONA_TEXT = [
  '你是百宝，一个独立于其他对话的长期助手。',
  '说话简洁、直接、有温度；先给结论，再给依据；不谄媚，不堆砌。',
  '不确定就说不确定；不伪造能力、文件、命令或记忆。',
  '涉及删除、发布、支付等不可逆操作时，先确认再执行。',
].join('\n')

const PERSONA_TEXT_LIMIT = 600

let baibaoWorkspacePath = null
let presetsReady = null

// The persona text is injected per agent from `config.persona.text` in the
// `agent/created` handler, so the preset must not carry its own hardcoded
// prefix: a stale copy would silently override the user's edits in the very
// path that always composes this preset.
/**
 * Decide whether a shell can be driven through a PTY on this machine.
 *
 * A plain `spawn` probe is NOT sufficient: PowerShell 7 installed from the
 * Store is a 0-byte app-execution-alias reparse point. `CreateProcess` follows
 * it, so a naive spawn check reports success, while conpty cannot execute it
 * and the PTY dies at startup. The reliable signal is therefore the file
 * itself: a zero-length reparse point is an alias, not a real executable.
 */
async function isPtySafeShell(command) {
  if (process.platform !== 'win32') return true
  const { execFile } = await import('node:child_process')
  const resolved = await new Promise((resolve) => {
    execFile('where', [command], (error, stdout) => {
      resolve(
        error
          ? null
          : stdout
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter((line) => line !== '')[0],
      )
    })
  })
  if (resolved === null) return false
  const { stat } = await import('node:fs/promises')
  try {
    const info = await stat(resolved)
    // An app-execution-alias stub is exactly 0 bytes and carries a reparse
    // point; a genuine install has a real image on disk.
    if (info.size === 0) return false
    return true
  } catch {
    return false
  }
}

/**
 * Pick the terminal shell for this machine.
 *
 * Prefers PowerShell 7, and falls back to Windows PowerShell 5.1 when pwsh is
 * only an app-execution alias (Store install under conpty) or is missing.
 * Returns the dialect name the terminal plugin understands.
 */
async function resolveShellDialect() {
  if (process.platform !== 'win32') return 'bash'
  const safe = await isPtySafeShell('pwsh')
  return safe ? 'pwsh' : 'powershell'
}

function baibaoPlugins(shellDialect) {
  return [
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
            shellDialect,
            timeoutMs: 300000,
          },
        },
        // Keep the plugin id fixed. Swapping it for a per-dialect package was
        // tried and broke preset registration: only `dsh-tool-pwsh-persistent`
        // and `dsh-tool-bash-persistent` exist, so a `powershell` variant made
        // the whole preset `broken` and Baibao silently fell back to standard.
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
}

/**
 * Last preset-registration outcome, surfaced through the diagnostic route so a
 * silent failure cannot masquerade as "no Baibao mode".
 */
let lastPresetStatus = { attempted: false, ok: false, error: null, dialect: null }

async function ensureBaibaoPreset(presets) {
  if (presets === undefined) {
    lastPresetStatus = { attempted: false, ok: false, error: 'service-missing', dialect: null }
    return false
  }
  try {
    const list = await presets.list()
    if (list.some((preset) => preset.id === 'baibao')) {
      const existing = list.find((preset) => preset.id === 'baibao')
      lastPresetStatus = {
        attempted: false,
        ok: true,
        error: null,
        dialect: null,
        alreadyPresent: true,
        broken: existing?.broken ?? null,
      }
      return true
    }
    const dialect = await resolveShellDialect()
    const plugins = baibaoPlugins(dialect)
    await presets.register({
      id: 'baibao',
      name: '百宝',
      description: '百宝的默认 Agent 模式：长期助手人格、文件与终端工具。',
      order: 20,
      plugins,
    })
    lastPresetStatus = { attempted: true, ok: true, error: null, dialect }
    return true
  } catch (error) {
    lastPresetStatus = {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      dialect: null,
    }
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
/** Where a memory came from; drives trust instead of a model-reported score. */
const MEMORY_SOURCES = new Set(['user-explicit', 'agent-inferred'])
const JUNG_AXES = ['energy', 'information', 'decisions', 'lifestyle']
const DEFAULT_JUNG = {
  energy: -20,
  information: 20,
  decisions: 30,
  lifestyle: 10,
}
let memoryQueue = Promise.resolve()

/**
 * 人格预设：一组四轴取值 + 一段风格说明。
 *
 * 预设只填「倾向」与「风格提示」，不覆盖用户的基础提示词——身份与原则
 * 始终来自 `config.persona.text`，预设只决定语气被拧到哪一侧。
 */
const PERSONA_PRESETS = [
  {
    id: 'balanced',
    name: '均衡',
    summary: '先理解，再给判断；多数场景下适用。',
    jung: { energy: -20, information: 20, decisions: 30, lifestyle: 10 },
    style: [
      '先复述对方在意的点，再给结论和依据。',
      '结论先行，但保留一句解释；不确定就说不确定。',
    ],
  },
  {
    id: 'direct',
    name: '直接',
    summary: '结论先行，指出问题，不绕弯。',
    jung: { energy: -10, information: 10, decisions: 90, lifestyle: 70 },
    style: [
      '第一句就给结论或判断，再给依据；不要铺垫。',
      '发现更优解时直接说，并说明代价；不为附和而附和。',
    ],
  },
  {
    id: 'warm',
    name: '温和',
    summary: '先接住情绪，再谈事情；少打断。',
    jung: { energy: 20, information: -10, decisions: 80, lifestyle: -10 },
    style: [
      '先回应对方的处境和情绪，再进入问题本身。',
      '多用「我们可以」，少用「你应该」；提问代替断言。',
    ],
  },
  {
    id: 'quiet',
    name: '安静',
    summary: '少说、想清楚再说；不主动延伸。',
    jung: { energy: -70, information: -20, decisions: -20, lifestyle: -50 },
    style: [
      '默认短答；只在被问到时展开。',
      '不主动追加建议、不开无关话题、不重复已知信息。',
    ],
  },
  {
    id: 'partner',
    name: '伙伴',
    summary: '一起把事情往前推；会追问关键约束。',
    jung: { energy: 60, information: 50, decisions: 20, lifestyle: 20 },
    style: [
      '把用户的事当成自己的事：主动追问关键约束，复述下一步。',
      '可以调侃，但不影响信息密度；收尾时列清楚待办。',
    ],
  },
]

function findPersonaPreset(id) {
  return PERSONA_PRESETS.find((preset) => preset.id === id)
}

function normalizeJung(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const result = {}
  for (const axis of JUNG_AXES) {
    const raw = source[axis]
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_JUNG[axis]
    result[axis] = Math.max(-100, Math.min(100, Math.round(value)))
  }
  return result
}

async function configFile() {
  const location = await readLocation()
  return path.join(location.root, 'config', 'baibao.json')
}

async function readConfigData() {
  try {
    const parsed = JSON.parse(await readFile(await configFile(), 'utf8'))
    if (parsed !== null && typeof parsed === 'object') return parsed
  } catch {
    // Missing or malformed config starts from defaults.
  }
  return { version: 1 }
}

async function writeConfigData(data) {
  const file = await configFile()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

async function readPersona() {
  const config = await readConfigData()
  const presetId = typeof config.persona?.preset === 'string' ? config.persona.preset : null
  const preset = presetId === null ? null : findPersonaPreset(presetId)
  return { jung: normalizeJung(config.persona?.jung), preset: preset?.id ?? null }
}

async function writePersona(input) {
  const config = await readConfigData()
  const jung = normalizeJung(input?.jung ?? input)
  // An explicit preset id switches the axes wholesale; `preset: null` keeps the
  // axes but drops the style block, i.e. a hand-tuned persona.
  let presetId = typeof config.persona?.preset === 'string' ? config.persona.preset : null
  if (typeof input?.preset === 'string') {
    presetId = findPersonaPreset(input.preset)?.id ?? null
  } else if (input?.preset === null) {
    presetId = null
  }
  config.persona = { ...config.persona, jung, preset: presetId }
  config.updatedAt = new Date().toISOString()
  await writeConfigData(config)
  return { jung, preset: presetId }
}

/**
 * Consolidation model settings.
 *
 * Defaults to null/undefined rather than a hardcoded model: `llm.stream`
 * requires a real provider id (S6), so an unset value means "let the caller
 * decide" and consolidation falls back to the heuristic extractor.
 */
async function readConsolidationModel() {
  const config = await readConfigData()
  const memory = config.memory ?? {}
  const provider = typeof memory.consolidationProvider === 'string' ? memory.consolidationProvider : null
  const model = typeof memory.consolidationModel === 'string' ? memory.consolidationModel : null
  return { provider, model }
}

/**
 * 倾向清晰度分档。
 * 依据 MBTI 官方对 preference clarity 的说明：荣格体系是分类工具而非测量工具，
 * 分数不表示「有多少」某种偏好，而表示这组对立项被选择得有多明确、多一致，
 * 即所报告偏好是真实偏好的可能性。官方分档为 Slight / Moderate / Clear / Very Clear，
 * 其中 Moderate 与 Clear 最常见，Slight 也不少见（[Clarifying Clarity](https://www.themyersbriggs.com/en-US/Access-Resources/Articles/clarifying-clarity)）。
 */
function clarityBand(value) {
  const magnitude = Math.abs(value)
  if (magnitude <= 15) return 'slight'
  if (magnitude <= 45) return 'moderate'
  if (magnitude <= 75) return 'clear'
  return 'very-clear'
}

const CLARITY_HINT = {
  slight: '两侧都用，边界模糊，别把任一侧说成定论',
  moderate: '有倾向但不固执，可按情境调整',
  clear: '多数时候如此，例外要说明',
  'very-clear': '一贯如此，可作为稳定默认',
}

const JUNG_DESCRIPTORS = {
  energy: { negative: '内向，先观察再表达', positive: '外向，主动交流' },
  information: { negative: '实感，重视事实与细节', positive: '直觉，重视模式与可能性' },
  decisions: { negative: '思考，先看逻辑一致性', positive: '情感，先照顾人的感受' },
  lifestyle: { negative: '感知，保持开放与探索', positive: '判断，喜欢计划与收束' },
}

const JUNG_LABELS = {
  energy: '能量来源',
  information: '信息获取',
  decisions: '决策方式',
  lifestyle: '生活方式',
}

/**
 * 人格配置的结构一致性检查。
 *
 * 只做确定性判断，不调 LLM：检查的是「这组取值注入后会给出自洽的语气吗」。
 * 返回的每条提示都对应一个用户可以自己改的配置项，而不是抽象评分。
 */
function personaAudit(persona) {
  const notes = []
  const jung = persona?.jung ?? {}
  const axes = JUNG_AXES.map((axis) => ({ axis, value: jung[axis] }))
  const extreme = axes.filter((item) => Math.abs(item.value) >= 90)
  const centered = axes.filter((item) => Math.abs(item.value) <= 10)

  if (extreme.length >= 3) {
    notes.push({
      level: 'warn',
      text: `有 ${extreme.length} 个轴接近极值（${extreme.map((item) => JUNG_LABELS[item.axis]).join('、')}），语气会非常单一，建议留出调整空间。`,
    })
  }
  if (centered.length >= 3) {
    notes.push({
      level: 'info',
      text: `有 ${centered.length} 个轴几乎居中（${centered.map((item) => JUNG_LABELS[item.axis]).join('、')}），人格接近默认语气。`,
    })
  }
  // Extremes on opposite axes cancel each other: the prompt ends up asking for
  // both terse and expansive answers in the same turn.
  if (jung.decisions >= 80 && jung.lifestyle >= 80) {
    notes.push({
      level: 'warn',
      text: '决策方式与生活方式同时很高，容易一边要求结论明确、一边要求保留多种可能；建议拉开一侧。',
    })
  }
  if (jung.energy <= -80 && jung.information >= 80) {
    notes.push({
      level: 'info',
      text: '内向与直觉同时很高，表现为想清楚再说但不急于展开；若希望更主动，调高能量来源。',
    })
  }
  if (typeof persona.preset !== 'string' && Math.abs(jung.decisions) <= 10) {
    notes.push({
      level: 'info',
      text: '未选择预设且决策方式居中，回答的直白程度不稳定；可以直接选一个预设作为基准。',
    })
  }
  return notes
}

function personaPrompt(persona) {
  const lines = ['你的人格倾向（荣格四轴；分数只表示倾向清晰度，不表示强弱）：']
  for (const axis of JUNG_AXES) {
    const value = persona.jung[axis]
    const descriptor = value < 0 ? JUNG_DESCRIPTORS[axis].negative : JUNG_DESCRIPTORS[axis].positive
    const band = clarityBand(value)
    lines.push(
      `- ${JUNG_LABELS[axis]}：偏${descriptor}（清晰度 ${band}：${CLARITY_HINT[band]}）`,
    )
  }
  const preset =
    typeof persona.preset === 'string' ? findPersonaPreset(persona.preset) : undefined
  if (preset !== undefined) {
    lines.push(`你的人格预设是「${preset.name}」，风格要求：`)
    for (const rule of preset.style) lines.push(`- ${rule}`)
  }
  lines.push(
    '用这些倾向调节语气和判断；不要向用户声明类型标签，也不要把清晰度说成能力高低。',
  )
  return lines.join('\n')
}

function normalizePersonaText(input) {
  const text = typeof input === 'string' ? input.trim() : DEFAULT_PERSONA_TEXT
  if (text === '') return DEFAULT_PERSONA_TEXT
  return text.slice(0, PERSONA_TEXT_LIMIT)
}

async function readPersonaText() {
  const config = await readConfigData()
  return normalizePersonaText(config.persona?.text)
}

async function writePersonaText(input) {
  const config = await readConfigData()
  const text = normalizePersonaText(input?.text)
  config.persona = { ...config.persona, text }
  config.updatedAt = new Date().toISOString()
  await writeConfigData(config)
  return text
}

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
  // Provenance drives trust; the model's own confidence is not trusted (S6).
  const source = MEMORY_SOURCES.has(input.source) ? input.source : 'agent-inferred'
  return { text, kind, tags, source }
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
        // The agent only calls this when the user asked to remember something,
        // so it is explicit provenance rather than an inference.
        const entry = await saveMemory({ ...input, source: 'user-explicit' })
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
          : entries.map((entry) => `- [${entry.id}] [${entry.kind}] ${entry.text}`).join('\n')
      },
    },
    {
      name: 'memory_forget',
      description:
        'Delete one Baibao memory when the user asks to forget it. Prefer the id returned by memory_search; if only a text fragment is known, pass it as `text` and the closest match is deleted.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Memory id from memory_search.' },
          text: { type: 'string', description: 'Text fragment, used when no id is known.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            deleted: { type: 'boolean' },
            id: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['deleted'],
          additionalProperties: false,
        },
        render: (value) => [
          {
            type: 'text',
            text: value.deleted ? `已删除：${value.text ?? ''}` : '没有找到该记忆。',
          },
        ],
      },
      execute: async (input) => {
        const id = typeof input?.id === 'string' && input.id.trim() !== '' ? input.id.trim() : null
        if (id !== null) {
          const removed = await deleteMemory(id)
          if (removed) return { deleted: true, id }
          // An unknown id falls through to the text path rather than failing.
        }
        const fragment = typeof input?.text === 'string' ? input.text.trim() : ''
        if (fragment === '') return { deleted: false }
        const match = await findMemoryByText(fragment)
        if (match === null) return { deleted: false }
        await deleteMemory(match.id)
        return { deleted: true, id: match.id, text: match.text }
      },
    },
  ]
}

/** Closest memory for a free-text fragment, or null when nothing matches. */
async function findMemoryByText(fragment) {
  const entries = await listMemory(fragment)
  if (entries.length > 0) return entries[0]
  const needle = normalizeMemoryText(fragment)
  if (needle === '') return null
  for (const entry of await listMemory()) {
    if (normalizeMemoryText(entry.text).includes(needle)) return entry
  }
  return null
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
  // Stable first-person facts: "我的猫叫年糕", "我的项目代号是百宝". These are
  // the L1 statements the memory design asks for; without them only explicit
  // instructions and stated preferences ever reach the store.
  const attribute = cleaned.match(
    /(我(?:的|们的是|家|目前在|现在在|做的是)[^。！？!?\n]{1,40}(?:是|叫|为|属于)[^。！？!?\n]{2,120})/,
  )
  const boundary = cleaned.match(/((?:不要|别)[^。！？!?\n]{2,160})/)
  const raw = (explicit?.[1] ?? preference?.[1] ?? attribute?.[1] ?? boundary?.[1])?.trim()
  if (raw === undefined || raw.length < 4) return null
  const value = raw.replace(/[。！？!?]+$/, '').trim()
  const kind = /喜欢|偏好|讨厌|不喜欢|希望|想要|习惯|不要|别/.test(value)
    ? 'preference'
    : 'fact'
  return { text: value, kind, tags: ['auto'] }
}

const lastConsolidatedTurns = new Map()

/**
 * Latest user message of the current turn, or null when unavailable.
 * `sessionQuery.readSurface` is already used by consolidation, so its shape is
 * known; anything unexpected degrades to null instead of throwing.
 */
async function readLatestUserMessage(ctx, agent) {
  const query = ctx.get('sessionQuery')
  if (query === undefined) return null
  try {
    const surface = await query.readSurface(agent.id)
    const users = (surface?.events ?? []).filter((event) => event.type === 'user/message')
    const latest = users[users.length - 1]
    return latest === undefined ? null : messageText(latest.data)
  } catch {
    return null
  }
}

/** Newest-first user messages of this agent's surface, capped. */
async function readRecentUserMessages(ctx, agent, limit = 6) {
  const query = ctx.get('sessionQuery')
  if (query === undefined) return []
  try {
    const surface = await query.readSurface(agent.id)
    const users = (surface?.events ?? []).filter((event) => event.type === 'user/message')
    return users
      .slice(-limit)
      .map((event) => messageText(event.data).trim())
      .filter((text) => text !== '')
      .reverse()
  } catch {
    return []
  }
}

/**
 * Refresh the memory section from a query.
 *
 * Falls back to the recent list when the query yields nothing, so a turn about
 * something unrelated still gets the same context a fresh agent would.
 */
async function refreshMemorySection(agentCtx, query) {
  const results = query === '' ? [] : await searchMemory(query, 8)
  const entries = results.length > 0 ? results : await listMemory()
  if (entries.length === 0) return
  try {
    agentCtx.systemPrompt.section({
      name: 'baibao-memory-context',
      order: 60,
      text: renderMemoryContext(entries),
    })
  } catch {
    // A resumed agent may already own the section in this scope.
  }
}

/** True when the agent's session lives in the Baibao workspace. */
function isBaibaoAgent(agent, workspacePath) {
  if (workspacePath === null) return false
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string') return false
  return normalizePath(cwd) === normalizePath(workspacePath)
}

/**
 * Consolidation prompt.
 *
 * Two constraints come straight from the S6 measurements, not guesswork:
 * - the model drifted to English once in ten runs, so the language is pinned
 *   and every extracted text is CJK-checked before it can be stored;
 * - `confidence` was 0.9–0.95 for almost every entry, so it is ignored here and
 *   trust is assigned by provenance instead (see `SOURCE_TRUST`).
 */
const CONSOLIDATION_INSTRUCTION = [
  '你是百宝的记忆整理器。从对话中提取关于用户的**长期**事实。',
  '',
  '只输出 JSON，不要解释，不要 Markdown 代码围栏：',
  '{"facts":[{"text":"一句独立完整的话","kind":"fact|preference","tags":["可选标签"]}]}',
  '没有值得记住的内容时输出 {"facts":[]}。',
  '',
  '规则：',
  '- 所有 text 必须用简体中文，不要翻译成英文。',
  '- 只记跨会话仍然成立的信息：身份、稳定偏好、长期在做的项目、明确约定。',
  '- 不要记一次性请求、当前任务的中间状态、助手自己的回复内容。',
  '- 每条 text 独立成句，不依赖上下文也能读懂。',
  '- 最多 8 条，挑最重要的。',
].join('\n')

/** Provenance-based trust; the model's own confidence is not used (see S6). */
const SOURCE_TRUST = {
  'user-explicit': 0.95,
  'agent-inferred': 0.6,
}

/** A stored entry may carry provenance; older entries default to inferred. */
function trustOf(entry) {
  const source = typeof entry?.source === 'string' ? entry.source : null
  return source === null ? SOURCE_TRUST['agent-inferred'] : (SOURCE_TRUST[source] ?? 0.6)
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(text)
}

/** Strip an optional code fence, then parse. Returns null when unusable. */
function parseConsolidationReply(raw) {
  if (typeof raw !== 'string') return null
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed
  try {
    parsed = JSON.parse(unfenced)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.facts)) return null
  const facts = []
  for (const item of parsed.facts) {
    if (item === null || typeof item !== 'object') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text === '' || text.length > 400) continue
    // S6 saw one English reply in ten; drop non-Chinese text rather than let
    // the store become a mix of languages.
    if (!hasCjk(text)) continue
    const kind = MEMORY_KINDS.has(item.kind) ? item.kind : 'fact'
    const tags = Array.isArray(item.tags)
      ? item.tags
          .filter((tag) => typeof tag === 'string' && tag.trim() !== '')
          .slice(0, 6)
      : []
    facts.push({ text, kind, tags })
    if (facts.length >= 8) break
  }
  return facts
}

/**
 * Call `llm.stream` and return the consolidated facts, or null when the model
 * is unavailable or the reply is unusable.
 *
 * The API shape here is what S6 verified; see plan-tech/spikes.md §S6.
 */
async function extractFactsWithLlm(ctx, conversation, options = {}) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') return null
  // `llm.stream` rejects a missing provider with NO_ADAPTER (S6), so an unset
  // model means "decline" rather than "try and fail".
  const provider = typeof options.provider === 'string' ? options.provider : null
  const model = typeof options.model === 'string' ? options.model : null
  if (provider === null || model === null) return null
  const prompt = [CONSOLIDATION_INSTRUCTION, '', '对话：', ...conversation].join('\n')
  let stream
  try {
    stream = await llm.stream({
      provider,
      model,
      purpose: 'dsh-baibao: memory consolidation',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })
  } catch {
    return null
  }
  let text = ''
  let stopped = false
  try {
    for await (const chunk of stream) {
      if (chunk?.type === 'block-end' && typeof chunk.block?.text === 'string') {
        text = chunk.block.text
      } else if (chunk?.type === 'finish') {
        // Model-layer failures arrive here, not as a thrown error.
        stopped = chunk.reason?.kind === 'stop'
      }
    }
  } catch {
    return null
  }
  if (!stopped) return null
  return parseConsolidationReply(text)
}

/**
 * LLM-backed consolidation, falling back to the heuristic extractor when the
 * model is unavailable so the explicit-memory loop keeps working.
 *
 * Returns the entries actually written, for logging and tests.
 */
async function consolidateAgent(ctx, agent, workspacePath = baibaoWorkspacePath, options = {}) {
  if (!isBaibaoAgent(agent, workspacePath)) return []
  // Scan the recent messages rather than only the last one: a preference is
  // often stated across two messages ("别记这个" / "记住了，用简洁版").
  const messages = await readRecentUserMessages(ctx, agent)
  if (messages.length === 0) return []
  const stored = new Set((await listMemory()).map((entry) => normalizeMemoryText(entry.text)))
  const written = []

  const facts = await extractFactsWithLlm(ctx, messages, options)
  if (facts !== null) {
    for (const fact of facts) {
      const fingerprint = normalizeMemoryText(fact.text)
      if (stored.has(fingerprint)) continue
      const entry = await saveMemory({
        ...fact,
        source: 'agent-inferred',
        tags: [...fact.tags, 'llm'],
      })
      stored.add(fingerprint)
      written.push(entry)
    }
    return written
  }

  // Heuristic fallback: rule-based extraction over the same messages.
  for (const text of messages) {
    const candidate = extractMemoryCandidate(text)
    if (candidate === null) continue
    if (stored.has(normalizeMemoryText(candidate.text))) continue
    const entry = await saveMemory(candidate)
    stored.add(normalizeMemoryText(candidate.text))
    written.push(entry)
  }
  return written
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
  // Resolves once preset registration has settled, or false on timeout. The
  // timer must not resolve before a late-but-successful registration, otherwise
  // `chat/start` keeps omitting the preset for the rest of the session.
  let settlePresets = null
  presetsReady = new Promise((resolve) => {
    settlePresets = resolve
  })
  let settled = false
  const settle = (value) => {
    if (settled) return
    settled = true
    clearTimeout(presetTimer)
    settlePresets?.(value)
  }
  const presetTimer = setTimeout(() => settle(false), 3000)
  ctx.inject(['agentPresets'], (presetCtx) => {
    void ensureBaibaoPreset(presetCtx.agentPresets)
      .then((ready) => settle(ready))
      .catch(() => settle(false))
  })
  void readLocation()
    .then(() => {
      baibaoWorkspacePath = path.join(defaultRoot(), 'workspace')
    })
    .catch(() => {})

  ctx.effect(
    () =>
      ctx.on('agent/created', function (payload) {
        const agent = payload.agent
        const agentCtx = agent?.ctx
        if (agentCtx === undefined || !isBaibaoAgent(agent, baibaoWorkspacePath)) {
          return
        }
        const presets = ctx.get('agentPresets')
        void (async () => {
          // Composing the preset is still worth doing: it brings the file and
          // terminal tool rows. The persona text below is injected separately.
          if (presets?.composedPreset?.(agentCtx) !== 'baibao' && typeof presets?.select === 'function') {
            try {
              await presets.select(agent, 'baibao')
            } catch {
              // Closed sessions or a missing preset keep their current composition.
            }
          }
          // Always inject: the persona text follows `config.persona.text`, so
          // it must reach the agent whether the `baibao` preset composed or the
          // fallback section path ran.
          try {
            agentCtx.systemPrompt.section({
              name: 'baibao-persona',
              order: 50,
              text: await readPersonaText().catch(() => DEFAULT_PERSONA_TEXT),
            })
          } catch {
            // A resumed agent may already own the section in this scope.
          }
          try {
            for (const tool of memoryTools()) {
              agentCtx.tools.register(tool)
            }
          } catch {
            // A resumed agent may already own these tools in this scope.
          }
          // Seed the first turn with recent memories, then re-retrieve per turn
          // from the user's actual message instead of a fixed recent list.
          const seed = await listMemory()
          if (seed.length > 0) {
            try {
              agentCtx.systemPrompt.section({
                name: 'baibao-memory-context',
                order: 60,
                text: renderMemoryContext(seed),
              })
            } catch {
              // A resumed agent may already own the section in this scope.
            }
          }
          const persona = await readPersona().catch(() => ({
            jung: { ...DEFAULT_JUNG },
            preset: null,
          }))
          try {
            agentCtx.systemPrompt.section({
              name: 'baibao-persona-tuning',
              order: 51,
              text: personaPrompt(persona),
            })
          } catch {
            // A resumed agent may already own the section in this scope.
          }
          // One effect, two per-turn jobs: refresh memory for the next turn from
          // the message just sent, then consolidate. Both are async and must not
          // block the turn that is already stopping.
          agentCtx.effect(
            () =>
              agentCtx.on('agent/turn-stopping', (payload) => {
                const previous = lastConsolidatedTurns.get(agent.id)
                if (previous === payload.turn) return
                lastConsolidatedTurns.set(agent.id, payload.turn)
                void (async () => {
                  const latest = await readLatestUserMessage(ctx, agent)
                  if (latest !== null) {
                    await refreshMemorySection(agentCtx, latest).catch(() => {})
                  }
                  // Without a configured model the LLM path declines and the
                  // heuristic extractor runs instead, so nothing is lost.
                  const model = await readConsolidationModel().catch(() => ({
                    provider: null,
                    model: null,
                  }))
                  await consolidateAgent(ctx, agent, undefined, model).catch(() => {})
                })().catch(() => {})
              }),
            'dsh-baibao: turn memory',
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
          path: '/dsh-baibao/api/persona',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const [persona, text] = await Promise.all([
                  readPersona(),
                  readPersonaText(),
                ])
                sendJson(response, 200, {
                  ok: true,
                  persona,
                  text,
                  defaultText: DEFAULT_PERSONA_TEXT,
                  limit: PERSONA_TEXT_LIMIT,
                  presets: PERSONA_PRESETS,
                  audit: personaAudit(persona),
                })
                return
              }

              if (request.method === 'POST') {
                const body = await readJson(request)
                const persona = await writePersona(body)
                const text = body?.text === undefined ? await readPersonaText() : await writePersonaText(body)
                sendJson(response, 200, {
                  ok: true,
                  persona,
                  text,
                  defaultText: DEFAULT_PERSONA_TEXT,
                  limit: PERSONA_TEXT_LIMIT,
                  presets: PERSONA_PRESETS,
                  audit: personaAudit(persona),
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
      'dsh-baibao: persona route',
    )

    // TEMPORARY (PTY): diagnose "PTY shell exited during startup". Reports what
    // the terminal plugin would actually have to spawn, without starting one.
    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/spike/pty',
          handler: async (_request, response) => {
            const report = { ok: true, platform: process.platform }
            // Preset registration state, so "no Baibao mode" is diagnosable.
            report.preset = lastPresetStatus
            const presets = ctx.get('agentPresets')
            if (presets !== undefined && typeof presets.list === 'function') {
              try {
                const list = await presets.list()
                report.presetList = list.map((item) => ({
                  id: item.id,
                  broken: item.broken ?? null,
                }))
              } catch (error) {
                report.presetListError = error instanceof Error ? error.message : String(error)
              }
            } else {
              report.presetListError = 'agentPresets unavailable'
            }
            const which = async (cmd) => {
              const { execFile } = await import('node:child_process')
              return new Promise((resolve) => {
                execFile(
                  process.platform === 'win32' ? 'where' : 'which',
                  [cmd],
                  (error, stdout) => {
                    resolve(
                      error
                        ? null
                        : stdout
                            .split(/\r?\n/)
                            .map((line) => line.trim())
                            .filter((line) => line !== ''),
                    )
                  }
                )
              })
            }
            report.shellDialect = process.platform === 'win32' ? 'pwsh' : 'bash'
            report.pwsh = await which('pwsh')
            report.powershell = await which('powershell')
            report.bash = await which('bash')
            report.wsl = await which('wsl')
            // The PATH DSH itself sees, so a mismatch with the shell is visible.
            report.path = (process.env.PATH ?? '').split(';').filter((p) => p !== '')
            report.hasWindowsApps = report.path.some((p) =>
              p.toLowerCase().includes('windowsapps')
            )
            // `where` resolving is not enough: WindowsApps holds 0-byte reparse
            // points that some spawn paths (notably conpty) cannot execute. Try
            // the real thing and report what actually happens.
            const { spawn } = await import('node:child_process')
            const probe = async (label, cmd, args) => {
              const started = Date.now()
              return new Promise((resolve) => {
                let out = ''
                let err = ''
                const child = spawn(cmd, args, {
                  stdio: ['ignore', 'pipe', 'pipe'],
                  windowsHide: true,
                })
                child.stdout?.on('data', (chunk) => {
                  out += String(chunk)
                })
                child.stderr?.on('data', (chunk) => {
                  err += String(chunk)
                })
                child.on('error', (error) => {
                  resolve({
                    label,
                    cmd,
                    ok: false,
                    error: error.code ?? error.message,
                    elapsedMs: Date.now() - started,
                  })
                })
                child.on('exit', (code, signal) => {
                  resolve({
                    label,
                    cmd,
                    ok: code === 0,
                    code,
                    signal,
                    out: out.trim().slice(0, 120),
                    err: err.trim().slice(0, 200),
                    elapsedMs: Date.now() - started,
                  })
                })
                setTimeout(() => {
                  child.kill()
                  resolve({ label, cmd, ok: false, error: 'timeout', elapsedMs: Date.now() - started })
                }, 8000)
              })
            }
            report.spawn = [
              await probe('pwsh (PATH)', 'pwsh', ['-NoProfile', '-Command', 'echo pong']),
              await probe('pwsh (absolute)', report.pwsh?.[0] ?? '', ['-NoProfile', '-Command', 'echo pong']),
              await probe('powershell (PATH)', 'powershell', ['-NoProfile', '-Command', 'echo pong']),
            ].filter((entry) => entry.cmd !== '')

            // Inspect the terminal plugin's real config schema instead of
            // guessing which keys `shellDialect` accepts. `ctx.inspect` is the
            // documented surface for this; fall back gracefully if absent.
            try {
              const inspect = ctx.inspect
              if (typeof inspect === 'function') {
                const tree = await inspect()
                const flat = JSON.stringify(tree)
                report.inspectAvailable = true
                report.terminalPluginKeys = []
                const walk = (node) => {
                  if (node === null || typeof node !== 'object') return
                  if (Array.isArray(node)) {
                    node.forEach(walk)
                    return
                  }
                  const name = typeof node.name === 'string' ? node.name : ''
                  if (name.includes('dsh-terminal-bash') || name.includes('dsh-terminal')) {
                    report.terminalPluginKeys.push({
                      name,
                      config: node.config ?? null,
                      schema: node.schema ?? null,
                    })
                  }
                  for (const key of Object.keys(node)) {
                    if (key === 'config' || key === 'schema') continue
                    walk(node[key])
                  }
                }
                walk(tree)
                report.inspectSize = flat.length
              } else {
                report.inspectAvailable = false
              }
            } catch (error) {
              report.inspectError = error instanceof Error ? error.message : String(error)
            }
            sendJson(response, 200, report)
          },
        }),
      'dsh-baibao: pty diagnostic',
    )

    // TEMPORARY (S6): shape probe for the `llm` service. Removed once the real
    // signature is recorded; it only reads and never mutates state.
    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/spike/llm',          handler: async (request, response) => {
            const url = new URL(request.url ?? '/', 'http://localhost')
            const mode = url.searchParams.get('mode') ?? 'shape'
            const llm = ctx.get('llm')
            const report = { ok: true, present: llm !== undefined, mode }
            const safe = (value) =>
              JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v)))
            try {
              if (llm === undefined) {
                report.error = 'service-not-injected'
              } else {
                const proto = Object.getPrototypeOf(llm)
                report.ownKeys = Object.keys(llm)
                report.protoKeys = proto === null ? [] : Object.getOwnPropertyNames(proto)
                for (const key of [...report.ownKeys, ...report.protoKeys]) {
                  const value = llm[key]
                  report[`typeof:${key}`] = typeof value
                  if (typeof value === 'function') {
                    report[`fn:${key}.length`] = value.length
                    report[`fn:${key}.src`] = String(value).slice(0, 400)
                  }
                }
                if (mode === 'providers') {
                  for (const method of ['listProviders', 'listConfigurableProviders']) {
                    if (typeof llm[method] !== 'function') continue
                    try {
                      const list = await llm[method]()
                      report[method] = safe(list)
                    } catch (error) {
                      report[`${method}Error`] =
                        error instanceof Error ? error.message : String(error)
                    }
                  }
                }
                if (mode === 'resolve' && typeof llm.prepareCall === 'function') {
                  const provider = url.searchParams.get('provider') ?? 'nesercode-local-server'
                  const model = url.searchParams.get('model') ?? 'cn:step-5-preview'
                  const attempts = []
                  const candidates = [
                    { label: 'prompt', options: { prompt: 'ping', purpose: 'dsh-baibao-spike-s6' } },
                    {
                      label: 'messages',
                      options: { messages: [{ role: 'user', content: 'ping' }], purpose: 'dsh-baibao-spike-s6' },
                    },
                    {
                      label: 'contentBlocks',
                      options: {
                        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping' }] }],
                        purpose: 'dsh-baibao-spike-s6',
                      },
                    },
                    {
                      label: 'messages+tools',
                      options: {
                        messages: [{ role: 'user', content: 'ping' }],
                        tools: [],
                        purpose: 'dsh-baibao-spike-s6',
                      },
                    },
                  ]
                  for (const candidate of candidates) {
                    const entry = { label: candidate.label }
                    // `signal?.throwIfAborted is not a function` means one
                    // positional arg is an AbortSignal; try the plausible slots.
                    const signal = AbortSignal.timeout(15000)
                    for (const variant of [
                      ['signal,provider,model,options', signal, provider, model, candidate.options],
                      ['provider,model,options,signal', provider, model, candidate.options, signal],
                      ['signal,options', signal, candidate.options],
                      ['options,signal', candidate.options, signal],
                      ['provider,model,options', provider, model, candidate.options],
                      ['model,options', model, candidate.options],
                      ['options', candidate.options],
                    ]) {
                      try {
                        const result = await llm.prepareCall(...variant.slice(1))
                        entry.ok = variant[0]
                        entry.result = safe(result)
                        break
                      } catch (error) {
                        entry[`err:${variant[0]}`] =
                          error instanceof Error ? error.message : String(error)
                      }
                    }
                    attempts.push(entry)
                  }
                  report.prepareCallAttempts = attempts
                }
                // Structured-output probe: the actual question S6 asks. Runs the
                // same call N times and reports how many replies parse as the
                // expected JSON schema.
                if (mode === 'json' && typeof llm.stream === 'function') {
                  const provider = url.searchParams.get('provider') ?? 'nesercode-local-server'
                  const model = url.searchParams.get('model') ?? 'cn:fast-model'
                  const rounds = Math.max(
                    1,
                    Math.min(20, Number(url.searchParams.get('rounds') ?? 5)),
                  )
                  // `case=empty` must yield an empty array; `case=chat` is the
                  // realistic extraction; `case=lang` is the same call phrased in
                  // Chinese to test whether it stops the language drift seen in
                  // the first stability run.
                  const scenario = url.searchParams.get('case') ?? 'chat'
                  const instructions = {
                    empty: [
                      'Extract durable facts about the user from the conversation below.',
                      'Reply with JSON only, no prose and no code fence:',
                      '{"facts":[{"text":"...","kind":"fact|preference","confidence":0.9}]}',
                      'Use an empty array when there is nothing worth remembering.',
                      '',
                      'Conversation:',
                      'user: 帮我把这个函数改成异步的',
                      'assistant: 已经改好了。',
                      'user: 谢谢，再跑一下测试',
                    ].join('\n'),
                    chat: [
                      'Extract durable facts about the user from the conversation below.',
                      'Reply with JSON only, no prose and no code fence:',
                      '{"facts":[{"text":"...","kind":"fact|preference","confidence":0.9}]}',
                      'Use an empty array when there is nothing worth remembering.',
                      '',
                      'Conversation:',
                      'user: 记住我喜欢喝美式咖啡，别加糖',
                      'assistant: 好的，记住了。',
                      'user: 我的猫叫年糕，三岁了',
                    ].join('\n'),
                    lang: [
                      '从下面的对话中提取关于用户的长期事实。',
                      '只输出 JSON，不要解释，不要代码围栏：',
                      '{"facts":[{"text":"...","kind":"fact|preference","confidence":0.9}]}',
                      '没有值得记住的内容时返回空数组。所有 text 必须用简体中文。',
                      '',
                      '对话：',
                      'user: 记住我喜欢喝美式咖啡，别加糖',
                      'assistant: 好的，记住了。',
                      'user: 我的猫叫年糕，三岁了',
                    ].join('\n'),
                  }
                  const instruction = instructions[scenario] ?? instructions.chat
                  report.scenario = scenario
                  const runs = []
                  for (let index = 0; index < rounds; index += 1) {
                    const started = Date.now()
                    const run = { index }
                    try {
                      const stream = await llm.stream({
                        provider,
                        model,
                        purpose: 'dsh-baibao-spike-s6',
                        messages: [
                          { role: 'user', content: [{ type: 'text', text: instruction }] },
                        ],
                      })
                      let text = ''
                      let finishKind = null
                      let finishError = null
                      let usage = null
                      for await (const chunk of stream) {
                        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
                          text += chunk.text
                        } else if (
                          chunk?.type === 'block-end' &&
                          typeof chunk.block?.text === 'string'
                        ) {
                          text = chunk.block.text
                        } else if (chunk?.type === 'usage') {
                          usage = chunk.usage
                        } else if (chunk?.type === 'finish') {
                          finishKind = chunk.reason?.kind ?? null
                          finishError = chunk.reason?.failure?.message ?? null
                        }
                      }
                      run.elapsedMs = Date.now() - started
                      run.finishKind = finishKind
                      run.finishError = finishError
                      run.usage = usage ?? null
                      run.rawLength = text.length
                      run.raw = text.slice(0, 600)
                      // Language drift: the same prompt returned English once in
                      // ten runs. Flag any reply with no CJK characters so the
                      // consolidation prompt can be written to prevent it.
                      run.hasCjk = /[\u3400-\u9fff]/.test(text)
                      // Strip a code fence if the model added one, then parse.
                      const unfenced = text
                        .trim()
                        .replace(/^```(?:json)?\s*/i, '')
                        .replace(/\s*```$/, '')
                      let parsed = null
                      let parseError = null
                      try {
                        parsed = JSON.parse(unfenced)
                      } catch (error) {
                        parseError = error instanceof Error ? error.message : String(error)
                      }
                      run.parseError = parseError
                      run.parsed = parsed
                      run.valid =
                        parsed !== null &&
                        Array.isArray(parsed.facts) &&
                        parsed.facts.every(
                          (item) =>
                            item !== null &&
                            typeof item === 'object' &&
                            typeof item.text === 'string' &&
                            typeof item.kind === 'string',
                        )
                    } catch (error) {
                      run.error = error instanceof Error ? error.message : String(error)
                      run.valid = false
                    }
                    runs.push(run)
                  }
                  report.rounds = rounds
                  report.runs = runs
                  report.validCount = runs.filter((run) => run.valid === true).length
                  report.successRate = runs.length === 0 ? 0 : report.validCount / runs.length
                  report.cjkCount = runs.filter((run) => run.hasCjk === true).length
                  report.avgElapsedMs = Math.round(
                    runs.reduce((sum, run) => sum + (run.elapsedMs ?? 0), 0) /
                      Math.max(1, runs.length),
                  )
                  const totalUsage = runs.reduce(
                    (sum, run) => {
                      const usage = run.usage ?? {}
                      return {
                        inputTokens: sum.inputTokens + (usage.inputTokens ?? 0),
                        outputTokens: sum.outputTokens + (usage.outputTokens ?? 0),
                        totalTokens: sum.totalTokens + (usage.totalTokens ?? 0),
                      }
                    },
                    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
                  )
                  report.totalUsage = totalUsage
                  report.avgTokensPerRun = Math.round(totalUsage.totalTokens / Math.max(1, runs.length))
                }
                if (mode === 'models' && typeof llm.listModels === 'function') {
                  const provider = url.searchParams.get('provider')
                  const models =
                    provider === null ? await llm.listModels() : await llm.listModels(provider)
                  report.modelsType = Array.isArray(models) ? 'array' : typeof models
                  report.models = safe(models)
                }
                if (mode === 'call' && typeof llm.stream === 'function') {
                  const started = Date.now()
                  const chunks = []
                  const provider = url.searchParams.get('provider')
                  const model = url.searchParams.get('model')
                  const prompt = url.searchParams.get('prompt') ?? 'Reply with the single word: pong'
                  const shape = url.searchParams.get('shape') ?? 'prompt'
                  const base = { purpose: 'dsh-baibao-spike-s6' }
                  if (provider !== null) base.provider = provider
                  if (model !== null) base.model = model
                  // Candidate GenerateOptions shapes. Each error narrowed the
                  // next guess: `messages` is the right field, and its `content`
                  // must be an array of blocks, not a plain string.
                  const shapes = {
                    prompt: { ...base, prompt },
                    messages: { ...base, messages: [{ role: 'user', content: prompt }] },
                    input: { ...base, input: [{ role: 'user', content: prompt }] },
                    tools: { ...base, prompt, tools: [] },
                    messagesTools: {
                      ...base,
                      messages: [{ role: 'user', content: prompt }],
                      tools: [],
                    },
                    contentBlocks: {
                      ...base,
                      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
                    },
                    contentBlocksTools: {
                      ...base,
                      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
                      tools: [],
                    },
                  }
                  const options = shapes[shape] ?? shapes.prompt
                  report.requestShape = shape
                  report.requestOptions = options
                  let stream
                  try {
                    stream = await llm.stream(options)
                  } catch (error) {
                    report.callError = error instanceof Error ? error.message : String(error)
                  }
                  if (stream !== undefined) {
                    report.streamType = typeof stream
                    report.streamIsArray = Array.isArray(stream)
                    report.streamKeys =
                      stream === null || typeof stream !== 'object' ? null : Object.keys(stream)
                    // The return may be an async iterator, a sync iterator, or a
                    // plain value. Probe all three: silently reporting zero
                    // chunks would defeat the point of the spike.
                    const iterable =
                      stream !== null &&
                      typeof stream === 'object' &&
                      (typeof stream[Symbol.asyncIterator] === 'function' ||
                        typeof stream[Symbol.iterator] === 'function')
                    report.iterable = iterable
                    if (iterable) {
                      try {
                        for await (const chunk of stream) {
                          chunks.push(safe(chunk))
                          if (chunks.length >= 20) break
                        }
                      } catch (error) {
                        report.iterateError =
                          error instanceof Error ? error.message : String(error)
                      }
                    }
                    report.chunkCount = chunks.length
                    report.chunks = chunks
                  }
                  report.elapsedMs = Date.now() - started
                }
              }
            } catch (error) {
              report.ok = false
              report.error = error instanceof Error ? error.message : String(error)
              report.stack = error instanceof Error ? error.stack?.slice(0, 800) : undefined
            }
            sendJson(response, 200, report)
          },
        }),
      'dsh-baibao: s6 llm probe',
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

    // Consolidation model settings plus the models actually available, so the
    // panel can offer real choices instead of a free-text field.
    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/config',
          handler: async (request, response) => {
            try {
              const llm = ctx.get('llm')
              const available =
                llm !== undefined && typeof llm.listProviders === 'function'
                  ? await llm.listProviders()
                  : []
              const models = []
              for (const provider of available) {
                if (typeof llm.listModels !== 'function') break
                try {
                  const list = await llm.listModels(provider.id)
                  for (const model of list) {
                    models.push({
                      provider: provider.id,
                      providerName: provider.name ?? provider.id,
                      id: model.id,
                      name: model.name ?? model.id,
                    })
                  }
                } catch {
                  // A provider without a working adapter is simply not offered.
                }
              }
              if (request.method === 'GET') {
                const current = await readConsolidationModel()
                sendJson(response, 200, {
                  ok: true,
                  consolidation: current,
                  models,
                })
                return
              }
              if (request.method === 'POST') {
                const body = await readJson(request)
                const config = await readConfigData()
                const memory = { ...(config.memory ?? {}) }
                const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
                const model = typeof body?.model === 'string' ? body.model.trim() : ''
                if (provider === '' || model === '') {
                  delete memory.consolidationProvider
                  delete memory.consolidationModel
                } else {
                  memory.consolidationProvider = provider
                  memory.consolidationModel = model
                }
                config.memory = memory
                config.updatedAt = new Date().toISOString()
                await writeConfigData(config)
                sendJson(response, 200, {
                  ok: true,
                  consolidation: await readConsolidationModel(),
                  models,
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
      'dsh-baibao: config route',
    )
  })
}
