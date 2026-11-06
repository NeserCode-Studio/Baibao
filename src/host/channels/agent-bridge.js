/**
 * Ask the Baibao agent a question and wait for its answer.
 *
 * Contract taken from the open-source package `deepseek-ai/deepseek-harness`,
 * `packages/api/session-controller/src/types.ts` — not inferred:
 *
 *   prompt({ requestId, sessionId, mode, content }, signal) -> { accepted }
 *   follow({ address: { kind: 'session', sessionId }, assistantStream }, signal)
 *     -> AsyncIterable<SessionFollowFrame>
 *
 * A follow frame is one of: `snapshot`, `event`, or `assistant-stream`. The
 * durable reply arrives as an `event` whose `event.type` names the message
 * kind, which is what this module reads: the streamed frames are presentation
 * detail, while the committed event is the message that will still be there on
 * a reload.
 */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { defaultRoot } from '../paths.js'
import { CHANNEL_LABELS, channelTitle, setChannelContext } from './context.js'
import { counterpartOf } from './store.js'
import { memoryTools } from '../memory.js'
import { pushTools } from '../push.js'
import { sessionTools } from './session-tools.js'

/**
 * One live session per chat, so two people talking to the same bot do not read
 * each other's conversation.
 */
const sessions = new Map()
/** Serialises turns per chat: two prompts into one inbox would interleave. */
let queue = Promise.resolve()

function withTurnLock(task) {
  const next = queue.then(task, task)
  queue = next.then(
    () => {},
    () => {},
  )
  return next
}

/**
 * Pull plain text out of a committed message event.
 *
 * The payload nests the message one level down:
 *   { message: { role: 'assistant', content: [{ type: 'text', text }] } }
 * Older or other event shapes put `content` at the top, so both are accepted.
 */
export function extractText(data) {
  const message = data?.message ?? data
  if (typeof message?.text === 'string') return message.text
  if (Array.isArray(message?.content)) {
    return message.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
  }
  return ''
}

/** True for the event kinds that carry assistant output. */
export function isAssistantEvent(type) {
  return typeof type === 'string' && type.startsWith('assistant/')
}

/**
 * Add a prompt section describing the current connector.
 *
 * The agent is the same Baibao everywhere, so it should be able to say "I can
 * see this on WeChat" rather than guess. Added per turn because the creation
 * hook fires before the session has been mapped to a connector.
 */
async function declareChannel(ctx, controller, sessionId, channel, userId) {
  const resolved = await controller.resolveAgent(sessionId)
  const agent = resolved?.agent
  const prompt = agent?.ctx?.systemPrompt
  if (prompt === undefined || typeof prompt.section !== 'function') return

  // Re-register the tools on every turn instead of trusting `agent/created`.
  // Agents outlive a plugin reload: they keep the tool set they were created
  // with, so a reload refreshed the host routes while the agent kept answering
  // from an older build. Registering here makes the agent catch up on the next
  // message rather than needing its own disposal.
  try {
    const tools = agent?.ctx?.tools
    if (tools !== undefined && typeof tools.register === 'function') {
      for (const tool of [...memoryTools(), ...pushTools(), ...sessionTools(ctx)]) {
        try {
          tools.register(tool)
        } catch {
          // Already registered by name; the existing definition wins.
        }
      }
    }
  } catch {
    // Tool registration is best effort; the turn still runs without it.
  }

  const label = CHANNEL_LABELS[channel] ?? channel
  const counterpart = await counterpartOf(channel, userId).catch(() => null)
  const lines = [
    `你现在通过「${label}」和这位用户对话。`,
    `用户在这个连接器上的标识是 ${userId}。`,
    '记忆是所有连接器共用的；每条对话的上下文各自独立，看不到彼此。',
  ]
  if (counterpart !== null) {
    // Without this the agent treats its own other conversation as a stranger's.
    const other = CHANNEL_LABELS[counterpart.channel] ?? counterpart.channel
    lines.push(`这位用户在「${other}」上也是同一个人，那边的对话同样是他的。`)
  }
  lines.push(
    '如果用户提到你在这个连接器之外说过的话，用 session_search 或 session_list 配合 session_read 去查，不要凭印象编造。',
  )
  prompt.section({
    name: 'baibao-channel-context',
    order: 55,
    text: lines.join(''),
  })
}

/**
 * Create the session for one chat, or reuse the live one.
 *
 * The session must be created with `workspaceId`, not `cwd`: the two are
 * exclusive in `SessionCreateRequest`, and a session created by `cwd` belongs to
 * no workspace at all — which is why it surfaced under "ungrouped" even though
 * its directory was right.
 *
 * A disposed or archived session must not wedge the channel forever, so the
 * caller rebuilds on failure rather than caching blindly.
 */
async function ensureSession(ctx, key, channel, userId) {
  const controller = ctx.get('sessionController')
  const workspaces = ctx.get('workspaceController')
  if (controller === undefined || workspaces === undefined) throw new Error('dsh-services-missing')
  const cached = sessions.get(key)
  if (cached !== undefined) {
    try {
      const resolved = await controller.resolveAgent(cached)
      if (resolved?.agent !== undefined) {
        // Re-assert the mapping: a process restart forgets it while the cached
        // session id may survive in a caller.
        setChannelContext(cached, { channel, userId, label: channelTitle(channel, userId) })
        return { controller, sessionId: cached }
      }
    } catch {
      // Gone or archived: fall through and make a new one.
    }
    sessions.delete(key)
  }

  const workspaceDir = path.join(defaultRoot(), 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  // Idempotent: resolves the existing Baibao workspace when there is one.
  const { workspace } = await workspaces.create({ path: workspaceDir })
  const created = await controller.create({
    workspaceId: workspace.workspaceId,
    agentPreset: 'baibao',
  })

  const title = channelTitle(channel, userId)
  setChannelContext(created.sessionId, { channel, userId, label: title })
  try {
    // Naming it by connector is what lets the agent tell its own conversations
    // apart later, in `session_list`.
    await controller.rename({ sessionId: created.sessionId, title })
  } catch {
    // A default title is not worth failing the first message over.
  }

  sessions.set(key, created.sessionId)
  return { controller, sessionId: created.sessionId }
}

/**
 * Send `text` to the agent and resolve with its reply.
 *
 * Resolves with an empty string rather than throwing when no reply arrives in
 * time: the caller is a phone client that deserves a clear message, not a
 * dropped request.
 *
 * @param options.timeoutMs how long to wait for a committed assistant message
 * @param options.log        (level, detail) => void
 */
export async function askAgent(ctx, text, options = {}) {
  // Agent turns that use tools routinely take a minute; two minutes is the
  // point where waiting longer is worse than a partial answer.
  const timeoutMs = options.timeoutMs ?? 120_000
  const log = options.log ?? (() => {})
  // One conversation per (connector, person); the connector is part of the key
  // because the same person may reach the bot through both.
  const channel = options.channel ?? 'qq'
  const userId = options.userId ?? 'unknown'
  const key = `${channel}:${userId}`

  return withTurnLock(async () => {
    const { controller, sessionId: target } = await ensureSession(ctx, key, channel, userId)

    const abort = new AbortController()
    let iterator = null
    let reply = ''
    let settle = null
    const answered = new Promise((resolve) => {
      settle = resolve
    })
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      reply = value
      settle(value)
    }

    try {
      iterator = controller
        .follow({ address: { kind: 'session', sessionId: target }, assistantStream: true }, abort.signal)
        [Symbol.asyncIterator]()

      // Tell the agent where it is talking. This is injected per turn rather
      // than once at creation, because the creation hook runs before the
      // session is mapped to a connector.
      await declareChannel(ctx, controller, target, channel, userId).catch(() => {})

      const seenTypes = new Set()
      void (async () => {
        try {
          for (;;) {
            const next = await iterator.next()
            if (next.done === true) return
            const frame = next.value
            if (frame?.type !== 'event') continue
            const type = frame.event?.type
            if (typeof type === 'string' && !seenTypes.has(type)) {
              seenTypes.add(type)
              log('debug', `event type: ${type}`)
            }
            if (!isAssistantEvent(type)) continue
            const value = extractText(frame.event?.data).trim()
            if (value !== '') finish(value)
          }
        } catch (error) {
          log('error', `follow: ${error instanceof Error ? error.message : String(error)}`)
          finish('')
        }
      })()

      const accepted = await controller.prompt(
        {
          requestId: randomUUID(),
          sessionId: target,
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
        AbortSignal.timeout(timeoutMs),
      )
      if (accepted?.accepted !== true) {
        finish('')
        return ''
      }

      // Wait on the reply signal, not on the subscription: an iterator that
      // does not honour abort would otherwise hold the turn open forever.
      const timer = setTimeout(() => finish(''), timeoutMs)
      const value = await answered
      clearTimeout(timer)
      if (value === '') log('debug', 'no assistant event before timeout')
      return value
    } catch (error) {
      log('error', `ask: ${error instanceof Error ? error.message : String(error)}`)
      // A dead session is the common failure; drop it so the next turn rebuilds.
      sessions.delete(key)
      return ''
    } finally {
      finish('')
      abort.abort()
    }
  })
}

/** Forget every cached session (used when the channel stops). */
export function resetChannelSessions() {
  sessions.clear()
}
