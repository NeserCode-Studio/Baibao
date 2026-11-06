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
// Namespace import on purpose: a named import of `zstdDecompressSync` throws at
// module-load time on a Node that predates zstd support (22.15+), which would
// take the whole plugin down rather than degrade one tool.
import * as zlib from 'node:zlib'
import { dshHome } from '../paths.js'

const SESSION_FILE = 'session.v4.jsonl.zstd'
/** Reading thirty logs is plenty for recall and keeps the turn fast. */
const MAX_SESSIONS = 30

/** zstd decompression, when this Node provides it. */
const zstdDecompress = typeof zlib.zstdDecompressSync === 'function' ? zlib.zstdDecompressSync : null

/** Why the last log read failed, for the diagnostics line. */
let lastReadError = ''

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

/** zstd frame magic, used to split an append-written multi-frame log. */
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

/**
 * Decompress every frame in an append-written zstd log.
 *
 * DSH writes one frame per append, so a finished log is a concatenation of
 * frames. Node 24.22's `zstdDecompressSync` walks all of them; the 24.21 build
 * embedded in the desktop app stops after the first, returning only the session
 * header. That difference is invisible — no error, just one record instead of
 * twenty-four — which is why every conversation looked empty while the files
 * were plainly full.
 *
 * Both paths are tried and the richer result wins, so whichever runtime this
 * runs on, it gets the whole log.
 */
function decompressAll(buffer) {
  if (zstdDecompress === null) return null

  let whole = null
  try {
    whole = zstdDecompress(buffer)
  } catch {
    whole = null
  }

  // Split on frame magic. A magic sequence inside compressed bytes would be a
  // false split; that frame simply fails to decompress and is skipped.
  const starts = [0]
  for (let index = 4; index < buffer.length - 3; index += 1) {
    if (
      buffer[index] === ZSTD_MAGIC[0] &&
      buffer[index + 1] === ZSTD_MAGIC[1] &&
      buffer[index + 2] === ZSTD_MAGIC[2] &&
      buffer[index + 3] === ZSTD_MAGIC[3]
    ) {
      starts.push(index)
      index += 3
    }
  }

  let joined = null
  if (starts.length > 1) {
    const parts = []
    for (let index = 0; index < starts.length; index += 1) {
      const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
      try {
        parts.push(zstdDecompress(buffer.subarray(starts[index], end)))
      } catch {
        // A false split: drop that frame rather than the whole log.
      }
    }
    if (parts.length > 0) joined = Buffer.concat(parts)
  }

  if (whole === null) return joined
  if (joined === null) return whole
  return joined.length >= whole.length ? joined : whole
}

/** Decode one session log into records, tolerating a truncated file. */
export function readLog(file) {
  if (zstdDecompress === null) {
    lastReadError = 'node-without-zstd'
    return []
  }
  let text
  try {
    const buffer = readFileSync(file)
    const decoded = decompressAll(buffer)
    if (decoded === null) {
      lastReadError = 'decompress-failed'
      return []
    }
    text = decoded.toString('utf8')
  } catch (error) {
    lastReadError = error instanceof Error ? (error.code ?? error.message) : 'decompress-failed'
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

/**
 * Read only the first frame, which holds the session header.
 *
 * The header carries `cwd`, and that is how a conversation is assigned to a
 * workspace — the directory name is a lossy encoding of the same path and cannot
 * be compared reliably. Decompressing one frame is cheap; the full log is not.
 */
export function readHeader(file) {
  if (zstdDecompress === null) return null
  let buffer
  try {
    buffer = readFileSync(file)
  } catch {
    return null
  }
  // Cut at the second frame so a single frame is decompressed.
  let end = buffer.length
  for (let index = 4; index < buffer.length - 3; index += 1) {
    if (
      buffer[index] === ZSTD_MAGIC[0] &&
      buffer[index + 1] === ZSTD_MAGIC[1] &&
      buffer[index + 2] === ZSTD_MAGIC[2] &&
      buffer[index + 3] === ZSTD_MAGIC[3]
    ) {
      end = index
      break
    }
  }
  try {
    const text = zstdDecompress(buffer.subarray(0, end)).toString('utf8')
    const first = text.split('\n').find((line) => line !== '')
    return first === undefined ? null : JSON.parse(first)
  } catch {
    return null
  }
}

/** Find one session log by id, regardless of position. */
export function findSessionLog(sessionId) {
  return listSessionLogs(200).find((row) => row.id === sessionId) ?? null
}

/** Normalized form for comparing workspace paths across separators and case. */
export function normalizeCwd(value) {
  if (typeof value !== 'string' || value === '') return ''
  return value.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Conversations the user has archived.
 *
 * Archiving removes a conversation from every grouping surface, so listing it
 * back would contradict what the user sees in the sidebar — the list would show
 * rows that are not there. Read-only: this file is DSH's, never written here.
 */
export function readArchivedIds() {
  try {
    const file = path.join(dshHome(), 'storages', 'workspace.json')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const ids = data?.global?.archivedSessionIds
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
  } catch {
    // An unreadable registry means "no known archives", not "everything".
    return new Set()
  }
}

/** The workspace registry plus the archive set, read once per call. */
function readRegistry() {
  try {
    const file = path.join(dshHome(), 'storages', 'workspace.json')
    const data = JSON.parse(readFileSync(file, 'utf8'))
    const workspaces = data?.tables?.workspaces
    const ids = data?.global?.archivedSessionIds
    return {
      workspaces:
        workspaces !== null && typeof workspaces === 'object' ? Object.values(workspaces) : [],
      archived: new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []),
    }
  } catch {
    // An unreadable registry means "nothing known", not "everything visible".
    return { workspaces: [], archived: new Set() }
  }
}

/**
 * Sessions belonging to one workspace, newest first.
 *
 * Membership comes from the workspace registry's own `sessionIds`, not from
 * matching `cwd`. A workspace lists the conversations it shows in the sidebar;
 * filtering by directory instead pulled in every conversation ever run against
 * that path, including ones the user had archived or simply never kept.
 *
 * Archived ids are removed so the list agrees with what the sidebar displays.
 */
export function listWorkspaceSessions(workspacePath, limit = MAX_SESSIONS) {
  const want = normalizeCwd(workspacePath)
  const registry = readRegistry()
  const workspace = registry.workspaces.find(
    (item) => item !== null && typeof item === 'object' && normalizeCwd(item.path) === want,
  )
  if (workspace === undefined) return []

  const live = (Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []).filter(
    (id) => typeof id === 'string' && !registry.archived.has(id),
  )
  const known = new Map(listSessionLogs(400).map((row) => [row.id, row]))
  const rows = live.map((id) => known.get(id)).filter((row) => row !== undefined)
  rows.sort((left, right) => right.updatedAt - left.updatedAt)
  return rows.slice(0, limit)
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
  const parts = [
    `node=${process.versions.node}`,
    `zstd=${zstdDecompress === null ? 'MISSING' : 'ok'}`,
    `home=${home}`,
    `env=${process.env.DSH_HOME ?? '(unset)'}`,
  ]
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
  if (lastReadError !== '') parts.push(`lastReadError=${lastReadError}`)
  return parts.join(' ')
}
