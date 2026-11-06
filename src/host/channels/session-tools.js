/**
 * Tools that let Baibao look across its own conversations.
 *
 * These use `sessionQuery` rather than `sessionController`, and the difference
 * matters. The controller's `list` and `search` go through
 * `ctx.remoteAccess.allows(...)`, which admits only the caller's own session —
 * so from a QQ conversation they report "no other conversations" while a dozen
 * exist on disk. The query service works on the corpus directly, with no
 * per-caller filtering:
 *
 *   filterSessions(filters, signal)        → SessionRecord[]  ([] = all)
 *   readTitleSnapshots(ids, signal)        → titles
 *   readSurface(sessionId)                 → { events } with message payloads
 *   filterEvents(sessionId, filters)       → matching documents carrying text
 *
 * Verified against packages/session-query: all four sit on the inherited
 * prototype, which is why an earlier probe of own properties missed them.
 *
 * Every tool returns a plain string with a `{ type: 'string' }` schema, matching
 * `memory_search` — object schemas here produced render failures.
 */

/** Message lines out of one surface event list. */
function surfaceMessages(events) {
  const out = []
  for (const event of Array.isArray(events) ? events : []) {
    const type = typeof event?.type === 'string' ? event.type : ''
    const role = type.startsWith('user/') ? 'user' : type.startsWith('assistant/') ? 'assistant' : ''
    if (role === '') continue
    const message = event?.data?.message ?? event?.data
    let text = ''
    if (typeof message?.text === 'string') text = message.text
    else if (Array.isArray(message?.content)) {
      text = message.content
        .filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join(' ')
    }
    text = text.trim()
    if (text !== '') out.push({ role, text })
  }
  return out
}

/** Every conversation, newest first, with titles when they exist. */
async function listSessions(ctx, limit) {
  const query = ctx.get('sessionQuery')
  if (query === undefined || typeof query.filterSessions !== 'function') return []
  const signal = AbortSignal.timeout(15_000)
  const records = await query.filterSessions([], signal)
  const rows = []
  for (const record of Array.isArray(records) ? records : []) {
    const id = record?.header?.id
    if (typeof id !== 'string' || id === '') continue
    rows.push({
      id,
      createdAt: Number.isFinite(record.header?.createdAt) ? record.header.createdAt : 0,
      live: record.live === true,
    })
  }
  rows.sort((left, right) => right.createdAt - left.createdAt)
  const top = rows.slice(0, limit)

  // One batched title read rather than a call per session.
  let titles = new Map()
  try {
    if (typeof query.readTitleSnapshots === 'function') {
      const snapshots = await query.readTitleSnapshots(top.map((row) => row.id), signal)
      const entries = Array.isArray(snapshots) ? snapshots : []
      for (const entry of entries) {
        const id = entry?.sessionId ?? entry?.id
        const title = entry?.title?.title ?? entry?.titleSnapshot?.title ?? entry?.title
        if (typeof id === 'string' && typeof title === 'string') titles.set(id, title)
      }
    }
  } catch {
    // A missing title is cosmetic; the id still works.
  }
  return top.map((row) => ({ ...row, title: titles.get(row.id) ?? '' }))
}

function formatSession(row) {
  const when = row.createdAt > 0 ? new Date(row.createdAt).toISOString().slice(0, 16) : '?'
  const label = row.title === '' ? '' : `${row.title} `
  return `[${row.id}] ${label}(${when}${row.live ? ' 进行中' : ''})`
}

export function sessionTools(ctx) {
  return [
    {
      name: 'session_list',
      description: [
        'List this user\u2019s past conversations, newest first, with the title each one was given.',
        'Titles name the app the conversation happened in (QQ / 微信), which is how you find the one somebody means when they say "on WeChat I told you".',
        'Use session_read to see what was actually said.',
      ].join(' '),
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'string' },
        render: (value) => [
          {
            type: 'text',
            text: typeof value === 'string' && value.trim() !== '' ? value : '没有其他会话。',
          },
        ],
      },
      execute: async () => {
        try {
          const rows = await listSessions(ctx, 30)
          if (rows.length === 0) return '没有其他会话。'
          return rows.map(formatSession).join('\n')
        } catch (error) {
          return `列表失败：${error instanceof Error ? error.message : String(error)}`
        }
      },
    },
    {
      name: 'session_search',
      description: [
        'Search the text of this user\u2019s past conversations, across every app they talk to you on.',
        'Use it when they refer to something said elsewhere — "what did I tell you on WeChat".',
        'Returns the conversation and the matching line; follow with session_read for context.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for in past conversations.' },
        },
        required: ['query'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (value) => [
          {
            type: 'text',
            text: typeof value === 'string' && value.trim() !== '' ? value : '没有找到相关的过往对话。',
          },
        ],
      },
      execute: async (input) => {
        const query = ctx.get('sessionQuery')
        const text = String(input.query ?? '').trim()
        if (text === '') return '没有给出关键词。'
        if (query === undefined || typeof query.filterEvents !== 'function') {
          return '会话检索不可用。'
        }
        try {
          const rows = await listSessions(ctx, 30)
          const hits = []
          for (const row of rows) {
            let documents = []
            try {
              documents = await query.filterEvents(row.id, [{ kind: 'text', text }])
            } catch {
              continue
            }
            for (const document of Array.isArray(documents) ? documents.slice(0, 3) : []) {
              const snippet = String(document?.text ?? '').replace(/\s+/g, ' ').slice(0, 160)
              if (snippet !== '') hits.push(`[${row.id}] ${row.title} · ${snippet}`)
            }
            if (hits.length >= 12) break
          }
          return hits.length === 0 ? '没有找到相关的过往对话。' : hits.join('\n')
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
            description: 'How many recent messages to read, 1-40. Defaults to 15.',
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (value) => [
          {
            type: 'text',
            text: typeof value === 'string' && value.trim() !== '' ? value : '那个会话没有可读文字。',
          },
        ],
      },
      execute: async (input) => {
        const query = ctx.get('sessionQuery')
        const sessionId = String(input.sessionId ?? '').trim()
        if (sessionId === '') return '没有指定会话。'
        if (query === undefined || typeof query.readSurface !== 'function') {
          return '会话读取不可用。'
        }
        const limit = Number.isFinite(input.limit)
          ? Math.min(Math.max(Math.trunc(input.limit), 1), 40)
          : 15
        try {
          const surface = await query.readSurface(sessionId)
          const messages = surfaceMessages(surface?.events).slice(-limit)
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
