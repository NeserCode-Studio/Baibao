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

/** One live channel session, reused across messages so context accumulates. */
let sessionId = null
/** Serialises turns: two prompts at once would interleave in one inbox. */
let queue = Promise.resolve()

function withTurnLock(task) {
  const next = queue.then(task, task)
  queue = next.then(
    () => {},
    () => {},
  )
  return next
}

/** Pull plain text out of a message payload, whatever shape it arrives in. */
export function extractText(data) {
  if (typeof data?.text === 'string') return data.text
  if (Array.isArray(data?.content)) {
    return data.content
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
 * Create the channel session, or reuse the live one.
 *
 * A disposed or archived session must not wedge the channel forever, so the
 * caller rebuilds on failure rather than caching blindly.
 */
async function ensureSession(ctx) {
  const controller = ctx.get('sessionController')
  const registry = ctx.get('workspaceRegistry')
  if (controller === undefined || registry === undefined) throw new Error('dsh-services-missing')

  if (sessionId !== null) {
    try {
      const resolved = await controller.resolveAgent(sessionId)
      if (resolved?.agent !== undefined) return { controller, sessionId }
    } catch {
      // Gone or archived: fall through and make a new one.
    }
    sessionId = null
  }

  const { defaultRoot } = await import('../paths.js')
  const { mkdir } = await import('node:fs/promises')
  const path = await import('node:path')
  const workspaceDir = path.join(defaultRoot(), 'workspace')
  await mkdir(workspaceDir, { recursive: true })
  const workspace = await registry.create(workspaceDir, '百宝')
  const created = await controller.create({ cwd: workspace.path, agentPreset: 'baibao' })
  sessionId = created.sessionId
  return { controller, sessionId }
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
  const timeoutMs = options.timeoutMs ?? 90_000
  const log = options.log ?? (() => {})

  return withTurnLock(async () => {
    const { controller, sessionId: target } = await ensureSession(ctx)

    const abort = new AbortController()
    let iterator = null
    let reply = ''
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      reply = value
      abort.abort()
    }

    try {
      iterator = controller
        .follow({ address: { kind: 'session', sessionId: target }, assistantStream: true }, abort.signal)
        [Symbol.asyncIterator]()

      // Collect in the background so the prompt is not blocked behind the
      // subscription's opening snapshot.
      const pump = (async () => {
        for (;;) {
          const next = await iterator.next()
          if (next.done === true) return
          const frame = next.value
          if (frame?.type !== 'event') continue
          const type = frame.event?.type
          if (!isAssistantEvent(type)) continue
          const value = extractText(frame.event?.data).trim()
          if (value !== '') finish(value)
        }
      })().catch((error) => {
        log('error', `follow: ${error instanceof Error ? error.message : String(error)}`)
        finish('')
      })

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

      const timer = setTimeout(() => finish(''), timeoutMs)
      await pump
      clearTimeout(timer)
      return settled ? reply : ''
    } catch (error) {
      log('error', `ask: ${error instanceof Error ? error.message : String(error)}`)
      // A dead session is the common failure; drop it so the next turn rebuilds.
      sessionId = null
      return ''
    } finally {
      abort.abort()
    }
  })
}

/** Forget the cached session (used when the channel stops). */
export function resetChannelSession() {
  sessionId = null
}
