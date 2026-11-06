/**
 * Long-term memory: the JSON store, the lexical search, and the `memory_*`
 * tools the agent calls.
 *
 * Storage is one file, `<root>/memory/memory.json`, written through a serial
 * queue plus a temp-file rename so concurrent saves cannot interleave or leave
 * a truncated file.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { rootFile } from './paths.js'

export const MEMORY_KINDS = new Set(['fact', 'preference', 'episode'])
/** Where a memory came from; drives trust instead of a model-reported score. */
export const MEMORY_SOURCES = new Set(['user-explicit', 'agent-inferred'])

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
  return rootFile('memory', 'memory.json')
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

export function normalizeMemoryInput(input) {
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

export function normalizeMemoryText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s，。！？!?；;：:、,.()（）\[\]{}]/g, '')
}

/**
 * Search terms for a query.
 *
 * Chinese has no spaces, so runs of CJK are expanded into overlapping
 * bigrams; that keeps matching useful without a tokenizer dependency.
 */
export function memoryTerms(query) {
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

/** Newest-first; an empty query returns everything. */
export async function listMemory(query = '') {
  const data = await readMemoryData()
  const terms = memoryTerms(query)
  return data.entries
    .filter((entry) => {
      if (terms.length === 0) return true
      const text = String(entry.text ?? '').toLowerCase()
      const tags = Array.isArray(entry.tags)
        ? entry.tags.map((tag) => String(tag).toLowerCase())
        : []
      return terms.some((term) => text.includes(term) || tags.some((tag) => tag.includes(term)))
    })
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

export async function saveMemory(input) {
  return withMemoryLock(async () => {
    const data = await readMemoryData()
    const normalized = normalizeMemoryInput(input)
    const fingerprint = normalizeMemoryText(normalized.text)
    const existing = data.entries.find((entry) => normalizeMemoryText(entry.text) === fingerprint)
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

export async function deleteMemory(id) {
  return withMemoryLock(async () => {
    const data = await readMemoryData()
    const index = data.entries.findIndex((entry) => entry.id === id)
    if (index < 0) return false
    data.entries.splice(index, 1)
    await writeMemoryData(data)
    return true
  })
}

export async function searchMemory(query, limit = 10) {
  const entries = await listMemory(query)
  return entries.slice(0, Math.max(1, Math.min(50, limit)))
}

/** Closest memory for a free-text fragment, or null when nothing matches. */
export async function findMemoryByText(fragment) {
  const entries = await listMemory(fragment)
  if (entries.length > 0) return entries[0]
  const needle = normalizeMemoryText(fragment)
  if (needle === '') return null
  for (const entry of await listMemory()) {
    if (normalizeMemoryText(entry.text).includes(needle)) return entry
  }
  return null
}

export function memoryTools() {
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
        render: (_args, value) => [{ type: 'text', text: `记得了：${value?.text ?? ""}` }],
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
        render: (_args, value) => [
          {
            type: 'text',
            text:
              typeof value === 'string'
                ? value
                : typeof value?.text === 'string'
                  ? value.text
                  : '没有找到相关记忆。',
          },
        ],
      },
      execute: async (input) => {
        const entries = await searchMemory(
          typeof input.query === 'string' ? input.query : '',
          typeof input.limit === 'number' ? input.limit : 10,
        )
        // Ids are part of the output: without them memory_forget has nothing
        // to act on and deletion becomes unreachable.
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
        render: (_args, value) => [
          {
            type: 'text',
            text: value?.deleted === true ? `已删除：${value.text ?? ''}` : '没有找到该记忆。',
          },
        ],      },
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
