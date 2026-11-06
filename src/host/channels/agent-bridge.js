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
 * Create the session for one chat, or reuse the live one.
 *
 * The session is also attached to the Baibao workspace through
 * `insertSessionBefore`. Workspace membership is an explicit `sessionIds` array
 * rather than something derived from `cwd`, so without that call the session
 * shows up under "ungrouped" even though its working directory is right.
 *
 * A disposed or archived session must not wedge the channel forever, so the
 * caller rebuilds on failure rather than caching blindly.
 */
async function ensureSession(ctx, key) {
  const controller = ctx.get('sessionController')
  const workspaces = ctx.get('workspaceController')
  if (controller === undefined || workspaces === undefined) throw new Error('dsh-services-missing')

  const cached = sessions.get(key)
  if (cached !== undefined) {
    try {
      const resolved = await controller.resolveAgent(cached)
      if (resolved?.agent !== undefined) return { controller, sessionId: cached }
    } catch {
      // Gone or archived: fall through and make a new one.
    }
    sessions.delete(key)
  }

  const workspaceDir = path.join(defaultRoot(), 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  // Idempotent: resolves the existing Baibao workspace when there is one.
  const { workspace } = await workspaces.create({ path: workspaceDir })
  const created = await controller.create({ cwd: workspace.path, agentPreset: 'baibao' })

  try {
    await workspaces.insertSessionBefore({
      workspaceId: workspace.workspaceId,
      sessionId: created.sessionId,
    })
  } catch {
    // Grouping is cosmetic; a conversation that works beats one filed neatly.
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
  const timeoutMs = options.timeoutMs ?? 60_000
  const log = options.log ?? (() => {})
  // One conversation per chat identity; two senders must not share memory.
  const key = options.chatId ?? 'default'

  return withTurnLock(async () => {
    const { controller, sessionId: target } = await ensureSession(ctx, key)

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
