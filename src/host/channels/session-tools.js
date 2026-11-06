/**
 * Tools that let Baibao look across its own conversations.
 *
 * The persona is one assistant reached through several apps, and a person may
 * mention something said elsewhere: "the picture I sent you on QQ". Memory
 * entries are already global, but the actual dialogue lives in sessions, so
 * these tools expose the documented session APIs:
 *
 *   search({ query })                        → { items: [{ sessionId, snippet }] }
 *   list({ cursor })                         → { items: SessionSummary[] }
 *   page({ address, maxMessages }, signal)   → { records }
 *
 * Reading is deliberately explicit: the agent searches or names a session, it
 * never silently loads everything.
 */

/** Turn a page record into `{ role, text }`, or null when it carries no text. */
export function readRecord(record) {
  const event = record?.event
  const type = typeof event?.type === 'string' ? event.type : ''
  const role = type.startsWith('user/') ? 'user' : type.startsWith('assistant/') ? 'assistant' : ''
  if (role === '') return null
  const message = event?.data?.message ?? event?.data
  if (typeof message?.text === 'string') return { role, text: message.text.trim() }
  if (!Array.isArray(message?.content)) return null
  const text = message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .trim()
  return text === '' ? null : { role, text }
}

/** Latest messages of one session, oldest first. */
async function readSession(ctx, sessionId, limit) {
  const controller = ctx.get('sessionController')
  if (controller === undefined) return []
  const page = await controller.page(
    { address: { kind: 'session', sessionId }, maxMessages: limit },
    AbortSignal.timeout(15_000),
  )
  const records = Array.isArray(page?.records) ? page.records : []
  return records.flatMap((record) => {
    const line = readRecord(record)
    return line === null ? [] : [line]
  })
}

export function sessionTools(ctx) {
  return [
    {
      name: 'session_search',
      description: [
        'Search across all of your own past conversations with this user.',
        'Use it when they refer to something said elsewhere — "what I told you on QQ", "the thing we discussed last week".',
        'Returns session ids with a matching snippet; follow up with session_read to see the surrounding messages.',
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
        schema: {
          type: 'object',
          properties: {
            hits: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  snippet: { type: 'string' },
                },
                required: ['sessionId', 'snippet'],
                additionalProperties: false,
              },
            },
          },
          required: ['hits'],
          additionalProperties: false,
        },
        render: (value) => [
          {
            type: 'text',
            text:
              value.hits.length === 0
                ? '没有找到相关的过往对话。'
                : value.hits.map((hit) => `[${hit.sessionId}] ${hit.snippet}`).join('\n'),
          },
        ],
      },
      execute: async (input) => {
        const controller = ctx.get('sessionController')
        if (controller === undefined) return { hits: [] }
        try {
          const result = await controller.search({ query: input.query })
          const items = Array.isArray(result?.items) ? result.items : []
          return {
            hits: items.slice(0, 10).map((item) => ({
              sessionId: String(item.sessionId),
              snippet: String(item.snippet ?? '').slice(0, 200),
            })),
          }
        } catch {
          return { hits: [] }
        }
      },
    },
    {
      name: 'session_list',
      description: [
        'List the recent conversations with this user, newest first.',
        'Titles show which app a conversation happened in (QQ / 微信), so this is how you find the session someone is referring to when you do not know its id.',
      ].join(' '),
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: {
          type: 'object',
          properties: {
            sessions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sessionId: { type: 'string' },
                  updatedAt: { type: 'string' },
                  running: { type: 'boolean' },
                },
                required: ['sessionId', 'updatedAt', 'running'],
                additionalProperties: false,
              },
            },
          },
          required: ['sessions'],
          additionalProperties: false,
        },
        render: (value) => [
          {
            type: 'text',
            text:
              value.sessions.length === 0
                ? '没有其他会话。'
                : value.sessions
                    .map(
                      (item) =>
                        `[${item.sessionId}] ${new Date(item.updatedAt).toISOString().slice(0, 16)}${
                          item.running ? ' (进行中)' : ''
                        }`,
                    )
                    .join('\n'),
          },
        ],
      },
      execute: async () => {
        const controller = ctx.get('sessionController')
        if (controller === undefined) return { sessions: [] }
        try {
          const result = await controller.list({})
          const items = Array.isArray(result?.items) ? result.items : []
          return {
            sessions: items.slice(0, 20).map((item) => ({
              sessionId: String(item.sessionId),
              updatedAt: Number.isFinite(item.updatedAt)
                ? new Date(item.updatedAt).toISOString()
                : '',
              running: item.running === true,
            })),
          }
        } catch {
          return { sessions: [] }
        }
      },
    },
    {
      name: 'session_read',
      description: [
        'Read the most recent messages of one conversation by its session id.',
        'Use this after session_search or session_list to see what was actually said.',
        'It reads only that conversation; it cannot read files.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session id from session_search or session_list.' },
          limit: { type: 'number', description: 'How many recent messages to read, 1-30. Defaults to 10.' },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            messages: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  role: { type: 'string' },
                  text: { type: 'string' },
                },
                required: ['role', 'text'],
                additionalProperties: false,
              },
            },
          },
          required: ['messages'],
          additionalProperties: false,
        },
        render: (value) => [
          {
            type: 'text',
            text:
              value.messages.length === 0
                ? '那个会话没有可读的文字内容。'
                : value.messages
                    .map((line) => `${line.role === 'user' ? '用户' : '我'}：${line.text}`)
                    .join('\n'),
          },
        ],
      },
      execute: async (input) => {
        const limit = Number.isFinite(input.limit)
          ? Math.min(Math.max(Math.trunc(input.limit), 1), 30)
          : 10
        try {
          return { messages: await readSession(ctx, input.sessionId, limit) }
        } catch {
          return { messages: [] }
        }
      },
    },
  ]
}
