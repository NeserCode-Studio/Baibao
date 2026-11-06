/**
 * Tencent QQ Bot (开放平台) channel client.
 *
 * Speaks the official v2 protocol:
 *   - credentials  → POST /app/getAppAccessToken  (7200s, self-refreshed)
 *   - gateway      → GET  /gateway
 *   - transport    → WebSocket, op 10 Hello → op 2 Identify → heartbeat 1/11
 *   - send         → POST /v2/users/{openid}/messages
 *
 * Verified against bot.q.qq.com/wiki (2026-07-30 revisions). Two rules shape
 * the design more than the rest:
 *
 * 1. A passive reply MUST carry the originating `msg_id`, is valid 60 minutes,
 *    and may be used at most four times per message. Anything later has to be
 *    an active message, which the user can switch off and which is rate limited.
 * 2. Sending requires the bot to be online on the WebSocket, so the socket is
 *    not optional — it is part of the send path.
 *
 * `GROUP_AND_C2C_EVENT` (1 << 25) is what carries C2C messages. It is not a
 * default intent: the bot must be granted that permission on the open platform,
 * otherwise Identify fails with 4013/4014.
 */
import { setTimeout as delay } from 'node:timers/promises'

const API_BASE = 'https://api.bot.qq.com'
/** Carries C2C_MESSAGE_CREATE, FRIEND_ADD, GROUP_AT_MESSAGE_CREATE, ... */
export const INTENT_GROUP_AND_C2C = 1 << 25
/** Minimum at Identify; the platform rejects an empty intent set. */
export const DEFAULT_INTENTS = INTENT_GROUP_AND_C2C

/** Refresh this long before expiry; the platform also rotates inside 60s. */
const TOKEN_REFRESH_MARGIN_MS = 90_000

const OP = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  RESUME: 6,
  RECONNECT: 7,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
}

/** Close codes that mean "this bot must not reconnect". */
const FATAL_CLOSE = new Map([
  [4914, 'bot-offline-sandbox-only'],
  [4915, 'bot-banned'],
])

// ------------------------------------------------------------------ REST side

/**
 * Cache one access token and refresh it ahead of expiry.
 *
 * The platform returns `expires_in` in seconds (7200). It explicitly does not
 * roll the token on every call, so caching is required rather than merely an
 * optimisation: calling per request would keep returning the same token.
 */
export class TokenCache {
  constructor(fetchToken) {
    this.fetchToken = fetchToken
    this.token = null
    this.expiresAt = 0
    this.pending = null
  }

  async get() {
    if (this.token !== null && Date.now() < this.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.token
    }
    // Collapse concurrent refreshes into one request.
    if (this.pending === null) {
      this.pending = this.fetchToken()
        .then((result) => {
          this.token = result.token
          this.expiresAt = Date.now() + result.expiresIn * 1000
          return this.token
        })
        .finally(() => {
          this.pending = null
        })
    }
    return this.pending
  }

  /** Drop the cached token so the next `get()` fetches a fresh one. */
  invalidate() {
    this.token = null
    this.expiresAt = 0
  }
}

/** Shape the platform returns from `/app/getAppAccessToken`. */
export function parseTokenResponse(body) {
  if (body === null || typeof body !== 'object') return null
  const token = typeof body.access_token === 'string' ? body.access_token : ''
  if (token === '') return null
  // `expires_in` arrives as a string in the documented example.
  const raw = body.expires_in
  const seconds = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return { token, expiresIn: seconds }
}

async function postJson(url, payload, token) {
  const headers = { 'content-type': 'application/json' }
  if (token !== undefined) headers.authorization = `QQBot ${token}`
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload ?? {}),
  })
  const text = await response.text()
  let body = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  return { status: response.status, ok: response.ok, body }
}

async function getJson(url, token) {
  const response = await fetch(url, {
    headers: token === undefined ? {} : { authorization: `QQBot ${token}` },
  })
  const text = await response.text()
  let body = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 500) }
  }
  return { status: response.status, ok: response.ok, body }
}

export async function fetchAccessToken(appId, clientSecret) {
  const result = await postJson(`${API_BASE}/app/getAppAccessToken`, { appId, clientSecret })
  if (!result.ok) {
    throw new Error(`token-http-${result.status}`)
  }
  const parsed = parseTokenResponse(result.body)
  if (parsed === null) throw new Error('token-malformed')
  return parsed
}

/** Gateway URL plus the platform's recommended shard count. */
export async function fetchGateway(token) {
  const result = await getJson(`${API_BASE}/gateway/bot`, token)
  if (!result.ok) throw new Error(`gateway-http-${result.status}`)
  const url = result.body?.url
  if (typeof url !== 'string' || url === '') throw new Error('gateway-malformed')
  return { url, shards: Number(result.body?.shards) || 1 }
}

/**
 * Send a C2C (direct) message.
 *
 * Passing `msgId` makes it a passive reply, which is the only kind that is
 * guaranteed to be delivered: active messages are refused when the user has
 * switched off "allow proactive messages". `msgSeq` disambiguates repeated
 * replies to the same message (same msg_id + msg_seq is rejected).
 */
export async function sendC2CMessage(token, openid, content, options = {}) {
  const payload = {
    msg_type: 0,
    content,
    ...(options.msgId === undefined ? {} : { msg_id: options.msgId }),
    ...(options.msgSeq === undefined ? {} : { msg_seq: options.msgSeq }),
  }
  const result = await postJson(
    `${API_BASE}/v2/users/${encodeURIComponent(openid)}/messages`,
    payload,
    token,
  )
  return result
}

// -------------------------------------------------------------- event shapes

/**
 * Normalise a `C2C_MESSAGE_CREATE` payload into the fields Baibao needs.
 *
 * Returns null for anything that is not a usable text message from a user:
 * the bot's own echoes, empty content, and non-text attachments all fall
 * through, since the agent cannot act on them meaningfully.
 */
export function parseC2CMessage(payload) {
  const data = payload?.d
  if (data === null || typeof data !== 'object') return null
  const author = data.author ?? {}
  if (author.bot === true) return null
  const content = typeof data.content === 'string' ? data.content.trim() : ''
  if (content === '') return null
  const openid = typeof author.user_openid === 'string' ? author.user_openid : ''
  if (openid === '') return null
  return {
    openid,
    content,
    messageId: typeof data.id === 'string' ? data.id : '',
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : '',
  }
}

// --------------------------------------------------------------- socket side

/**
 * Long-lived WebSocket connection to the QQ gateway.
 *
 * Handles the full lifecycle the protocol requires: Identify after Hello,
 * periodic heartbeat carrying the latest `s`, Resume after an unexpected drop,
 * and honouring Reconnect requests. Fatal close codes stop the loop instead of
 * retrying forever — a banned or sandbox-only bot must not hammer the gateway.
 */
export class QQGateway {
  /**
   * @param options.token     async () => access token
   * @param options.gateway   async (token) => { url }
   * @param options.intents   bitmask
   * @param options.onMessage async (message) => void, for C2C text
   * @param options.onStatus  (status) => void, for UI/state
   * @param options.log       (level, message) => void
   */
  constructor(options) {
    this.token = options.token
    this.gateway = options.gateway
    this.intents = options.intents ?? DEFAULT_INTENTS
    this.onMessage = options.onMessage ?? (() => {})
    this.onStatus = options.onStatus ?? (() => {})
    this.log = options.log ?? (() => {})

    this.socket = null
    this.sessionId = null
    this.lastSeq = null
    this.heartbeatTimer = null
    this.running = false
    this.backoff = 1000
    this.fatal = null
  }

  get connected() {
    return this.socket !== null && this.socket.readyState === 1
  }

  async start() {
    if (this.running) return
    this.running = true
    await this.#connectLoop()
  }

  stop() {
    this.running = false
    this.#clearHeartbeat()
    if (this.socket !== null) {
      try {
        this.socket.close(1000, 'stopped')
      } catch {
        // Already closed.
      }
      this.socket = null
    }
    this.#status('stopped')
  }

  #status(state, detail) {
    try {
      this.onStatus({ state, detail })
    } catch {
      // Status reporting must never break the loop.
    }
  }

  async #connectLoop() {
    while (this.running) {
      try {
        const token = await this.token()
        const { url } = await this.gateway(token)
        await this.#runOnce(token, url)
      } catch (error) {
        this.log('error', error instanceof Error ? error.message : String(error))
        this.#status('error', error instanceof Error ? error.message : String(error))
      }
      if (!this.running) break
      if (this.fatal !== null) {
        this.#status('fatal', this.fatal)
        break
      }
      // Reconnect with capped exponential backoff.
      const wait = Math.min(this.backoff, 30_000)
      this.backoff = Math.min(this.backoff * 2, 30_000)
      this.#status('reconnecting', `in ${wait}ms`)
      await delay(wait)
    }
  }

  /** One connection attempt; resolves when the socket closes. */
  async #runOnce(token, url) {
    return new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        this.#clearHeartbeat()
        resolve()
      }

      this.#status('connecting')
      const socket = new WebSocket(url)
      this.socket = socket

      socket.addEventListener('message', (event) => {
        let payload
        try {
          payload = JSON.parse(typeof event.data === 'string' ? event.data : '')
        } catch {
          return
        }
        this.#handlePayload(payload, token)
      })

      socket.addEventListener('error', () => {
        this.#status('error', 'socket-error')
      })

      socket.addEventListener('close', (event) => {
        this.#clearHeartbeat()
        const code = event.code
        if (FATAL_CLOSE.has(code)) this.fatal = FATAL_CLOSE.get(code)
        // 1000 is a deliberate stop; anything else is worth resuming.
        this.#status('closed', String(code))
        this.socket = null
        finish()
      })
    })
  }

  #handlePayload(payload, token) {
    if (payload === null || typeof payload !== 'object') return
    if (typeof payload.s === 'number') this.lastSeq = payload.s

    switch (payload.op) {
      case OP.HELLO:
        this.backoff = 1000
        this.#startHeartbeat(payload.d?.heartbeat_interval)
        if (this.sessionId !== null && this.lastSeq !== null) {
          this.#send({ op: OP.RESUME, d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.lastSeq } })
        } else {
          this.#identify(token)
        }
        return
      case OP.HEARTBEAT_ACK:
        return
      case OP.HEARTBEAT:
        // Server-initiated heartbeat: answer immediately.
        this.#send({ op: OP.HEARTBEAT, d: this.lastSeq })
        return
      case OP.RECONNECT:
        this.#status('reconnect-requested')
        this.socket?.close(4000, 'server-reconnect')
        return
      case OP.INVALID_SESSION:
        // Cannot resume; force a fresh Identify next time.
        this.sessionId = null
        this.lastSeq = null
        this.socket?.close(4001, 'invalid-session')
        return
      case OP.DISPATCH:
        this.#dispatch(payload)
        return
      default:
        return
    }
  }

  #dispatch(payload) {
    if (payload.t === 'READY') {
      this.sessionId = payload.d?.session_id ?? null
      this.#status('ready', payload.d?.user?.username ?? '')
      return
    }
    if (payload.t === 'RESUMED') {
      this.#status('ready', 'resumed')
      return
    }
    if (payload.t === 'C2C_MESSAGE_CREATE') {
      const message = parseC2CMessage(payload)
      if (message === null) return
      void Promise.resolve(this.onMessage(message)).catch((error) => {
        this.log('error', error instanceof Error ? error.message : String(error))
      })
    }
  }

  #identify(token) {
    this.#send({
      op: OP.IDENTIFY,
      d: {
        token: `QQBot ${token}`,
        intents: this.intents,
        // No sharding: one connection is enough for a personal bot.
        shard: [0, 1],
        properties: { $os: process.platform, $browser: 'dsh-baibao', $device: 'dsh-baibao' },
      },
    })
  }

  #startHeartbeat(intervalMs) {
    this.#clearHeartbeat()
    const period = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 45_000
    this.heartbeatTimer = setInterval(() => {
      this.#send({ op: OP.HEARTBEAT, d: this.lastSeq })
    }, period)
    // Do not hold the process open just for the heartbeat.
    this.heartbeatTimer.unref?.()
  }

  #clearHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  #send(payload) {
    if (this.socket === null || this.socket.readyState !== 1) return false
    try {
      this.socket.send(JSON.stringify(payload))
      return true
    } catch {
      return false
    }
  }
}
