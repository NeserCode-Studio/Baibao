/**
 * Owns the live channel connections.
 *
 * One connection per channel, started on demand from the settings panel and
 * stopped when disabled. The manager is deliberately thin: it wires the
 * protocol client to an `onMessage` callback and keeps a status object the UI
 * can read. What to *do* with a message (allow-list, agent, reply) belongs to
 * the caller, not here.
 */
import { QQGateway, fetchAccessToken, fetchGateway, sendC2CMessage, TokenCache } from './qq.js'
import { isUserAllowed, readChannels, writeChannel } from './store.js'
import { sendText } from './wechat.js'
import { WeChatRunner } from './wechat-runner.js'

/**
 * @typedef {object} ChannelRuntime
 * @property {string} state     stopped | connecting | ready | reconnecting | error | fatal
 * @property {string} [detail]
 * @property {string} [lastMessageAt]
 * @property {number} pending
 */

const runtimes = new Map()

/**
 * Handlers shared by every future connection.
 *
 * Set once at plugin start; `startChannel` merges them with per-call options so
 * a restart from the settings panel behaves identically to a boot-time start.
 */
let defaultOptions = {}

export function configureChannels(options) {
  defaultOptions = { ...defaultOptions, ...options }
}

/**
 * Senders who tried to reach the bot but are not on the allow-list.
 *
 * The OpenID of a user is only observable from their own message, so without
 * this the allow-list could never be filled in: the operator would have no way
 * to learn the id they are supposed to add. Kept in memory only — it is a
 * transient "who is knocking" list, not an audit log.
 */
const rejectedSenders = new Map()

export function pendingSenders() {
  return [...rejectedSenders.values()].sort((left, right) =>
    String(right.at).localeCompare(String(left.at)),
  )
}

export function forgetSender(openid) {
  rejectedSenders.delete(openid)
}

function noteRejected(message) {
  const existing = rejectedSenders.get(message.openid)
  rejectedSenders.set(message.openid, {
    openid: message.openid,
    at: new Date().toISOString(),
    // Keep a short excerpt so the operator can recognise who it is. The full
    // content is not stored.
    preview: message.content.slice(0, 60),
    count: (existing?.count ?? 0) + 1,
  })
}

/** Per-channel live state, safe to serialise. */
export function channelStatus() {
  const result = {}
  for (const [id, runtime] of runtimes) {
    result[id] = {
      state: runtime.state,
      ...(runtime.detail === undefined ? {} : { detail: runtime.detail }),
      ...(runtime.lastMessageAt === undefined ? {} : { lastMessageAt: runtime.lastMessageAt }),
      pending: runtime.pending,
    }
  }
  if (result.qq === undefined) result.qq = { state: 'stopped', pending: 0 }
  return result
}

function setRuntime(id, patch) {
  const current = runtimes.get(id) ?? { state: 'stopped', pending: 0, gateway: null, tokens: null }
  const next = { ...current, ...patch }
  runtimes.set(id, next)
  return next
}

/**
 * Start a channel if it is configured and allowed to run.
 *
 * @param options.onMessage async (message) => string for WeChat, void for QQ;
 *   QQ sends its own reply through `sendChannelText`, WeChat replies from the
 *   return value because its `context_token` is only valid for that message.
 * @param options.onRejected (message) => void, called for unknown senders so the
 *   UI can offer them for approval instead of silently dropping them
 * @param options.log (level, message) => void
 */
export async function startChannel(id, options = {}) {
  if (id !== 'qq' && id !== 'wechat') throw new Error('unknown-channel')
  const existing = runtimes.get(id)
  if (existing?.gateway?.running === true || existing?.runner?.running === true) {
    return channelStatus()
  }

  const merged = { ...defaultOptions, ...options }
  const channels = await readChannels()
  const log = merged.log ?? (() => {})

  if (id === 'wechat') {
    const channel = channels.wechat
    if (!channel.enabled) throw new Error('channel-disabled')
    if (channel.botToken === '') throw new Error('channel-unconfigured')

    const runner = new WeChatRunner({
      token: channel.botToken,
      log,
      isAllowed: async (userId) => isUserAllowed((await readChannels()).wechat, userId),
      onRejected: (inbound) => {
        noteRejected({ openid: inbound.userId, content: inbound.text })
        try {
          merged.onRejected?.(inbound)
        } catch {
          // Reporting must not break the loop.
        }
      },
      onStatus: (status) => {
        setRuntime(id, { state: status.state, detail: status.detail })
        // An expired login is worth persisting: it survives a restart, and the
        // panel must keep asking for a new scan until one succeeds.
        if (status.state === 'expired') {
          void writeChannel('wechat', { enabled: false }).catch(() => {})
        }
      },
      onMessage: async (inbound) => {
        setRuntime(id, { lastMessageAt: new Date().toISOString() })
        if (!inbound.hasText) return '目前只能处理文字消息，表情和图片还看不了。'
        const current = runtimes.get(id) ?? { pending: 0 }
        setRuntime(id, { pending: (current.pending ?? 0) + 1 })
        try {
          // Mirrors the QQ shape: the handler gets a `reply` it may call more
          // than once, and any return value is sent as the final answer. There
          // is no proactive channel here — `context_token` only covers the
          // inbound message — so everything has to go out through this.
          let sent = 0
          const reply = async (text) => {
            if (typeof text !== 'string' || text.trim() === '') return
            sent += 1
            const result = await sendText(channel.botToken, inbound.userId, text, inbound.contextToken)
            if (!result.ok) {
              log('error', `wechat send ${result.status}: ${JSON.stringify(result.body).slice(0, 200)}`)
            }
          }
          const answer = await merged.onMessage?.(
            {
              channel: 'wechat',
              userId: inbound.userId,
              text: inbound.text,
              hasText: inbound.hasText,
              contextToken: inbound.contextToken,
              messageId: inbound.messageId,
            },
            reply,
          )
          // A handler that already replied should not have its value sent twice.
          return sent > 0 ? '' : (answer ?? '')
        } finally {
          const after = runtimes.get(id) ?? { pending: 1 }
          setRuntime(id, { pending: Math.max(0, (after.pending ?? 1) - 1) })
        }
      },
    })

    setRuntime(id, { state: 'connecting', runner, gateway: null, tokens: null, pending: 0, detail: undefined })
    runner.start()
    return channelStatus()
  }

  const channel = channels.qq
  if (!channel.enabled) throw new Error('channel-disabled')
  if (channel.appId === '' || channel.appSecret === '') throw new Error('channel-unconfigured')

  const tokens = new TokenCache(() => fetchAccessToken(channel.appId, channel.appSecret))

  const gateway = new QQGateway({
    token: () => tokens.get(),
    gateway: (token) => fetchGateway(token),
    log,
    onStatus: (status) => {
      setRuntime(id, { state: status.state, detail: status.detail })
    },
    onMessage: async (message) => {
      setRuntime(id, { lastMessageAt: new Date().toISOString() })
      // Re-read the allow-list per message: the user may approve someone while
      // the connection is already up, and that must take effect immediately.
      const fresh = (await readChannels()).qq
      if (!isUserAllowed(fresh, message.openid)) {
        noteRejected(message)
        try {
          merged.onRejected?.(message)
        } catch {
          // Reporting must not break the loop.
        }
        return
      }
      const current = runtimes.get(id) ?? { pending: 0 }
      setRuntime(id, { pending: (current.pending ?? 0) + 1 })
      try {
        // QQ allows at most four passive replies per message, each needing a
        // distinct msg_seq — so replies are counted here rather than left to
        // the caller, which cannot know the limit was hit.
        let seq = 0
        const reply = async (text) => {
          if (typeof text !== 'string' || text.trim() === '') return
          if (seq >= 4) return
          seq += 1
          await sendChannelText('qq', message.openid, text, {
            msgId: message.messageId,
            msgSeq: seq,
          })
        }
        await merged.onMessage?.(
          {
            channel: 'qq',
            userId: message.openid,
            text: message.content,
            hasText: message.hasText,
            contextToken: '',
            messageId: message.messageId,
          },
          reply,
        )
      } catch (error) {
        log('error', error instanceof Error ? error.message : String(error))
      } finally {
        const after = runtimes.get(id) ?? { pending: 1 }
        setRuntime(id, { pending: Math.max(0, (after.pending ?? 1) - 1) })
      }
    },
  })

  setRuntime(id, { state: 'connecting', gateway, tokens, pending: 0, detail: undefined })
  void gateway.start()
  return channelStatus()
}

export function stopChannel(id) {
  const runtime = runtimes.get(id)
  if (runtime?.gateway !== undefined && runtime.gateway !== null) {
    runtime.gateway.stop()
  }
  if (runtime?.runner !== undefined && runtime.runner !== null) {
    runtime.runner.stop()
  }
  runtimes.set(id, { state: 'stopped', pending: 0, gateway: null, runner: null, tokens: null })
  return channelStatus()
}

/**
 * Send a text message back to a QQ user.
 *
 * `msgId` makes it a passive reply, valid for 60 minutes and at most four
 * times. Without it the platform treats the message as proactive, which the
 * user can switch off — so callers should always pass the id of the message
 * they are answering.
 */
export async function sendChannelText(id, openid, text, options = {}) {
  const runtime = runtimes.get(id)
  if (runtime?.tokens === undefined || runtime.tokens === null) throw new Error('channel-stopped')
  const token = await runtime.tokens.get()
  const result = await sendC2CMessage(token, openid, text, options)
  if (!result.ok) {
    const body = result.body
    const code = body?.code ?? body?.err_code ?? null
    // A rejected token is worth discarding so the next send fetches a new one.
    if (result.status === 401 || result.status === 403) runtime.tokens.invalidate()
    throw new Error(`qq-send-${result.status}${code === null ? '' : `-${code}`}`)
  }
  return result.body
}
