/**
 * Tools that let Baibao look across its own conversations.
 *
 * Backed by the session store on disk rather than by a service. Two service
 * attempts failed for different reasons: `sessionController` filters through
 * `remoteAccess.allows`, which admits only the caller's own session, and the
 * `sessionQuery` instance this plugin can reach does not expose the corpus
 * methods that documentation describes. Reading the logs has its own cost —
 * coupling to the storage layout — so that coupling lives in `session-files.js`
 * alone.
 *
 * Only the most recent conversations are read. A recall question is about
 * something said recently, and decompressing every log on every turn would turn
 * a one-second answer into a ten-second one.
 */

import {
  describeSessionStore,
  findSessionLog,
  listSessionLogs,
  listWorkspaceSessions,
  readSessionMessages,
  searchSessionLogs,
} from './session-files.js'
import { defaultRoot } from '../paths.js'
import path from 'node:path'
import { BUILD } from '../build.js'

/** How many recent conversations a search covers. */
const SEARCH_DEPTH = 20
/** How many conversations the list shows. */
const LIST_DEPTH = 20
/**
 * Stamped into every empty answer.
 *
 * The host routes are provably current (a recent field shows up in their
 * responses) while these tools keep answering in the wording of an older build.
 * That difference means the agent is holding tools registered before the last
 * reload, and without a version marker there is no way to tell from the outside
 * which copy is talking.
 */
const TOOL_BUILD = BUILD

function formatRow(row) {
  const when = row.updatedAt > 0 ? new Date(row.updatedAt).toISOString().slice(0, 16) : '?'
  const title = row.title === '' ? '（未命名）' : row.title
  return `[${row.id}] ${title} · ${when}`
}

/**
 * Coerce whatever the renderer hands us into displayable text.
 *
 * The tool's `execute` has been returning the right data all along — the UI's
 * "raw result" panel showed a full list of conversations while the rendered
 * text said there were none. The render callback was receiving something other
 * than the plain string it assumed and falling through to the fallback, so a
 * successful lookup displayed as an empty one.
 */
function toText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

/** Kept small on purpose: a long payload is what made render come back empty. */
const RENDER_LIMIT = 6000

/**
 * Render the tool's *result*, not its arguments.
 *
 * The signature is `render(args, value)` — two parameters. This module declared
 * one, so the single parameter received `args`: for a no-argument tool that is
 * `{}`, which is exactly what the UI displayed while the raw result panel beside
 * it showed the real conversation list.
 */
const stringOutput = (fallback) => ({
  schema: { type: 'string' },
  render: (_args, value) => {
    const text = toText(value)
    const trimmed = text.trim() === '' ? fallback : text
    const shown =
      trimmed.length > RENDER_LIMIT ? `${trimmed.slice(0, RENDER_LIMIT)}\n…（共 ${trimmed.length} 字）` : trimmed
    return [{ type: 'text', text: shown }]
  },
})

export function sessionTools(_ctx) {
  return [
    {
      name: 'session_list',
      description: [
        'List this user\u2019s recent conversations, newest first, with the title each was given.',
        'Titles name the app the conversation happened in (QQ / 微信), which is how you find the one somebody means when they say "on WeChat I told you".',
        'Follow with session_read to see what was actually said.',
      ].join(' '),
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: stringOutput('没有其他会话。'),
      execute: async () => {
        try {
          const rows = listWorkspaceSessions(path.join(defaultRoot(), 'workspace'), LIST_DEPTH)
          if (rows.length === 0) return `没有其他会话。诊断（${TOOL_BUILD}）：${describeSessionStore()}`
          return rows.map(formatRow).join('\n')
        } catch (error) {
          return `列表失败：${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
    {
      name: 'session_search',
      description: [
        'Search the text of this user\u2019s recent conversations across every app they talk to you on.',
        'Use it when they refer to something said elsewhere — "what did I tell you on WeChat".',
        'Returns the conversation, its title, and the matching line; follow with session_read for context.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for in past conversations.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: stringOutput('没有找到相关的过往对话。'),
      execute: async (input) => {
        const text = String(input.query ?? '').trim()
        if (text === '') return '没有给出关键词。'
        try {
          const hits = searchSessionLogs(text, SEARCH_DEPTH)
          if (hits.length === 0) return `没有找到相关的过往对话。诊断（${TOOL_BUILD}）：${describeSessionStore()}`
          return hits
            .slice(0, 12)
            .map((hit) => `[${hit.id}] ${hit.title} · ${hit.snippet}`)
            .join('\n')
        } catch (error) {
          return `检索失败：${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
    {
      name: 'session_read',
      description: [
        'Read the most recent messages of one conversation by its session id.',
        'Use it after session_search or session_list to see what was actually said.',
        'It reads only that conversation; it cannot read files.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session id from session_search or session_list.',
          },
          limit: {
            type: 'number',
            description: 'How many recent messages to read, 1-40. Defaults to 20.',
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
      output: stringOutput('那个会话没有可读文字。'),
      execute: async (input) => {
        const sessionId = String(input.sessionId ?? '').trim()
        if (sessionId === '') return '没有指定会话。'
        const limit = Number.isFinite(input.limit)
          ? Math.min(Math.max(Math.trunc(input.limit), 1), 40)
          : 20
        try {
          const row = findSessionLog(sessionId)
          if (row === null) return `找不到会话 ${sessionId}。`
          const messages = readSessionMessages(row.file, limit)
          if (messages.length === 0) return '那个会话没有可读文字。'
          return messages
            .map((line) => `${line.role === 'user' ? '用户' : '我'}：${line.text}`)
            .join('\n')
        } catch (error) {
          return `读取失败：${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
  ]
}
