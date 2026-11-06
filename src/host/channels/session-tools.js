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
 * Each tool returns a plain string with a `{ type: 'string' }` output schema,
 * matching `memory_search`. Object schemas here produced
 * "Cannot read properties of undefined (reading 'length')" inside `render`,
 * which the model saw as a broken tool — the same failure mode as the earlier
 * silent `catch`: a wrong shape that reports nothing useful.
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

/** Shared output shape: text in, text out, with a guard for an empty value. */
const stringOutput = (fallback) => ({
  schema: { type: 'string' },
  render: (value) => [
    { type: 'text', text: typeof value === 'string' && value.trim() !== '' ? value : fallback },
  ],
})

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
      output: stringOutput('没有找到相关的过往对话。'),
      execute: async (input) => {
        const controller = ctx.get('sessionController')
        if (controller === undefined) return '会话检索不可用。'
        try {
          const result = await controller.search({ query: String(input.query ?? '') })
          const items = Array.isArray(result?.items) ? result.items : []
          if (items.length === 0) return '没有找到相关的过往对话。'
          return items
            .slice(0, 10)
            .map((item) => `[${String(item.sessionId)}] ${String(item.snippet ?? '').slice(0, 200)}`)
            .join('\n')
        } catch (error) {
          return `检索失败：${error instanceof Error ? error.message : String(error)}`
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
      output: stringOutput('没有其他会话。'),
      execute: async () => {
        const controller = ctx.get('sessionController')
        if (controller === undefined) return '会话列表不可用。'
        try {
          const result = await controller.list({})
          const items = Array.isArray(result?.items) ? result.items : []
          if (items.length === 0) return '没有其他会话。'
          return items
            .slice(0, 20)
            .map((item) => {
              const when = Number.isFinite(item.updatedAt)
                ? new Date(item.updatedAt).toISOString().slice(0, 16)
                : '?'
              return `[${String(item.sessionId)}] ${when}${item.running === true ? ' (进行中)' : ''}`
            })
            .join('\n')
        } catch (error) {
          return `列表失败：${error instanceof Error ? error.message : String(error)}`
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
          sessionId: {
            type: 'string',
            description: 'Session id from session_search or session_list.',
          },
          limit: {
            type: 'number',
            description: 'How many recent messages to read, 1-30. Defaults to 10.',
          },
        },
        required: ['sessionId'],
        additionalProperties: false,
      },
      output: stringOutput('那个会话没有可读的文字内容。'),
      execute: async (input) => {
        const limit = Number.isFinite(input.limit)
          ? Math.min(Math.max(Math.trunc(input.limit), 1), 30)
          : 10
        const sessionId = String(input.sessionId ?? '')
        if (sessionId === '') return '没有指定会话。'
        try {
          const messages = await readSession(ctx, sessionId, limit)
          if (messages.length === 0) return '那个会话没有可读的文字内容。'
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
