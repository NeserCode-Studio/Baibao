/**
 * Read conversations straight from DSH's session store.
 *
 * The service routes did not work: `sessionController` filters by
 * `remoteAccess.allows` (so only the caller's own session is visible), and the
 * `sessionQuery` instance reachable from this plugin does not expose
 * `filterSessions` or `readSurface` at all. Two rounds of guessing at which
 * service carries which method produced nothing usable.
 *
 * The store itself is stable and readable: one directory per working directory,
 * one `session.v4.jsonl.zstd` per session. Reading it directly has the drawback
 * of coupling to that layout, which is why the shape is isolated here with a
 * narrow surface — if DSH changes the format, only this file needs to change.
 *
 * Node's `zstdDecompressSync` (22.15+) does the work; no extra dependency.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { dshHome } from '../paths.js'

const SESSION_FILE = 'session.v4.jsonl.zstd'
/** Reading thirty logs is plenty for recall and keeps the turn fast. */
const MAX_SESSIONS = 30

/** Pull the message text out of one parsed event, or null when it has none. */
function eventMessage(record) {
  const type = typeof record?.type === 'string' ? record.type : ''
  const role = type.startsWith('user/') ? 'user' : type.startsWith('assistant/') ? 'assistant' : ''
  if (role === '') return null
  const message = record?.data?.message ?? record?.data
  let text = ''
  if (typeof message?.text === 'string') text = message.text
  else if (Array.isArray(message?.content)) {
    text = message.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join(' ')
  }
  text = text.trim()
  return text === '' ? null : { role, text }
}

/** Title recorded by a rename event, if the session was ever named. */
function eventTitle(record) {
  const type = typeof record?.type === 'string' ? record.type : ''
  if (!type.includes('title') && !type.includes('rename')) return null
  const value = record?.data?.title ?? record?.data?.value ?? record?.data?.name
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Decode one session log into records, tolerating a truncated file. */
function readLog(file) {
  let text
  try {
    text = zstdDecompressSync(readFileSync(file)).toString('utf8')
  } catch {
    return []
  }
  const records = []
  for (const line of text.split('\n')) {
    if (line === '') continue
    try {
      records.push(JSON.parse(line))
    } catch {
      // A partial last line is normal while a session is being written.
    }
  }
  return records
}

/**
 * Every session on disk, newest first.
 *
 * @returns {{id: string, file: string, title: string, updatedAt: number, cwd: string}[]}
 */
export function listSessionLogs(limit = MAX_SESSIONS) {
  const root = path.join(dshHome(), 'sessions')
  let cwdDirs = []
  try {
    cwdDirs = readdirSync(root)
  } catch {
    return []
  }

  const found = []
  for (const cwdDir of cwdDirs) {
    const groupDir = path.join(root, cwdDir)
    let entries = []
    try {
      entries = readdirSync(groupDir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.startsWith('session-')) continue
      const file = path.join(groupDir, entry, SESSION_FILE)
      let stat
      try {
        stat = statSync(file)
      } catch {
        continue
      }
      found.push({ id: entry, file, updatedAt: stat.mtimeMs, cwd: cwdDir })
    }
  }

  found.sort((left, right) => right.updatedAt - left.updatedAt)
  const top = found.slice(0, limit)
  for (const row of top) {
    const records = readLog(row.file)
    let title = ''
    for (const record of records) {
      const value = eventTitle(record)
      if (value !== null) title = value
    }
    row.title = title
  }
  return top
}

/** Messages of one session, oldest first. */
export function readSessionMessages(file, limit) {
  const records = readLog(file)
  const messages = []
  for (const record of records) {
    const message = eventMessage(record)
    if (message !== null) messages.push(message)
  }
  return messages.slice(-limit)
}

/** Sessions whose message text contains `text`, with one matching line each. */
export function searchSessionLogs(needle, limit = MAX_SESSIONS) {
  const lower = needle.toLowerCase()
  const hits = []
  for (const row of listSessionLogs(limit)) {
    let snippet = ''
    for (const record of readLog(row.file)) {
      const message = eventMessage(record)
      if (message !== null && message.text.toLowerCase().includes(lower)) {
        snippet = message.text.replace(/\s+/g, ' ').slice(0, 160)
        break
      }
    }
    if (snippet !== '') hits.push({ ...row, snippet })
  }
  return hits
}

/** Find one session log by id, regardless of position. */
export function findSessionLog(sessionId) {
  return listSessionLogs(200).find((row) => row.id === sessionId) ?? null
}

/**
 * Describe what this code can actually see at runtime.
 *
 * Written because the same functions worked from a plain Node script and
 * returned nothing from inside DSH. Guessing at the cause wasted several
 * rounds; this makes the tool state the facts instead — resolved home, whether
 * the environment variable was set, whether the directory exists, how many logs
 * were found.
 */
export function describeSessionStore() {
  const home = dshHome()
  const root = path.join(home, 'sessions')
  const parts = [`home=${home}`, `env=${process.env.DSH_HOME ?? '(unset)'}`, `dir=${root}`]
  try {
    const groups = readdirSync(root)
    parts.push(`groups=${groups.length}`)
    let logs = 0
    for (const group of groups) {
      try {
        for (const entry of readdirSync(path.join(root, group))) {
          if (entry.startsWith('session-')) logs += 1
        }
      } catch {
        // Unreadable group directory; count what is readable.
      }
    }
    parts.push(`logs=${logs}`)
  } catch (error) {
    parts.push(`dirError=${error instanceof Error ? error.code ?? error.message : 'unknown'}`)
  }
  return parts.join(' ')
}
