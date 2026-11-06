/**
 * WeChat iLink bot channel (微信 iLink 机器人).
 *
 * Protocol reference: the iLink Bot API as used by Tencent's official
 * `@tencent-weixin/openclaw-weixin` plugin. All of it is plain HTTPS, so no
 * gateway process is involved:
 *
 *   GET  /ilink/bot/get_bot_qrcode?bot_type=3      → QR to scan
 *   GET  /ilink/bot/get_qrcode_status?qrcode=<tok> → status, then bot_token
 *   POST /ilink/bot/getupdates                     → long poll (35s)
 *   POST /ilink/bot/sendmessage                    → reply
 *
 * Two rules differ from QQ and shape the code:
 *
 * 1. A reply MUST echo the inbound message's `context_token`. There is no
 *    "active message" path here, so a reply that loses its context cannot be
 *    delivered at all.
 * 2. The session expires (`errcode -14`) and must be re-established by scanning
 *    a new QR code. Nothing refreshes it automatically — the official plugin has
 *    the same limitation (openclaw issues #91933, #90949), which is why the
 *    expiry is surfaced to the user rather than retried forever.
 */
import { randomBytes, randomInt } from 'node:crypto'

export const ILINK_BASE = 'https://ilinkai.weixin.qq.com'
/** Sent as `base_info.channel_version`; the server does not validate it tightly. */
const CHANNEL_VERSION = '1.0.0'

/** `ret` values that mean the login is gone and a new QR scan is required. */
export const SESSION_EXPIRED = -14

/** A stable device fingerprint for this DSH install. */
function uin() {
  // base64 of a random uint32, per the protocol's X-WECHAT-UIN header.
  return Buffer.from(String(randomInt(0, 0xffffffff))).toString('base64')
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION }
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers })
  const text = await response.text()
  let body = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 300) }
  }
  return { status: response.status, ok: response.ok, body }
}

async function postJson(path, payload, token) {
  const headers = {
    'content-type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'X-WECHAT-UIN': uin(),
  }
  if (token !== undefined) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`${ILINK_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...payload, base_info: baseInfo() }),
  })
  const text = await response.text()
  let body = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 300) }
  }
  return { status: response.status, ok: response.ok, body }
}

// ------------------------------------------------------------------ login

/**
 * Ask for a login QR code.
 *
 * `qrcode_img_content` is misleadingly named: it is the URL of a WeChat H5 page
 * that renders the code with JavaScript, not an image. The caller has to encode
 * that URL into a QR image itself, which is why `url` is returned raw here.
 */
export async function requestQrCode() {
  const result = await getJson(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`)
  if (!result.ok) throw new Error(`qrcode-http-${result.status}`)
  const qrcode = result.body?.qrcode
  if (typeof qrcode !== 'string' || qrcode === '') throw new Error('qrcode-malformed')
  const url = typeof result.body?.qrcode_img_content === 'string' ? result.body.qrcode_img_content : ''
  return { qrcode, url }
}

/** Normalise the login status poll. */
export function parseQrStatus(body) {
  const status = typeof body?.status === 'string' ? body.status : 'unknown'
  const token = typeof body?.bot_token === 'string' ? body.bot_token : ''
  return {
    status,
    // `confirmed` with a token is the only success; anything else keeps waiting.
    done: status === 'confirmed' && token !== '',
    expired: status === 'expired',
    botToken: token,
    botId: typeof body?.ilink_bot_id === 'string' ? body.ilink_bot_id : '',
    userId: typeof body?.ilink_user_id === 'string' ? body.ilink_user_id : '',
    baseUrl: typeof body?.baseurl === 'string' ? body.baseurl : '',
  }
}

/** Poll one login attempt. */
export async function pollQrStatus(qrcode) {
  const result = await getJson(
    `${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    { 'iLink-App-ClientVersion': '1' },
  )
  if (!result.ok) throw new Error(`qrcode-status-http-${result.status}`)
  return parseQrStatus(result.body)
}

// ----------------------------------------------------------------- messages

/**
 * One long-poll round.
 *
 * The server holds the connection for up to 35 seconds, so this is not a busy
 * loop and does not need client-side throttling.
 */
export async function getUpdates(token, cursor = '', signal) {
  const response = await fetch(`${ILINK_BASE}/ilink/bot/getupdates`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      Authorization: `Bearer ${token}`,
      'X-WECHAT-UIN': uin(),
    },
    body: JSON.stringify({ get_updates_buf: cursor, base_info: baseInfo() }),
    ...(signal === undefined ? {} : { signal }),
  })
  const text = await response.text()
  let body = null
  try {
    body = text === '' ? null : JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 300) }
  }
  return { status: response.status, ok: response.ok, body }
}

/** True when the poll result means the login must be redone. */
export function isSessionExpired(body) {
  const code = body?.errcode ?? body?.ret
  return Number(code) === SESSION_EXPIRED
}

/**
 * Reply to one inbound message.
 *
 * `contextToken` is mandatory: without it the platform has no conversation to
 * attach the message to.
 */
export async function sendText(token, toUserId, text, contextToken) {
  const payload = {
    msg: {
      from_user_id: '',
      to_user_id: toUserId,
      client_id: randomBytes(8).toString('hex'),
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [{ type: 1, text_item: { text } }],
    },
  }
  return postJson('/ilink/bot/sendmessage', payload, token)
}

/**
 * Extract the text of an inbound user message.
 *
 * Returns null for anything that is not a user text message: bot echoes, empty
 * text, and pure media all fall through, but the caller still needs the sender
 * identity for those cases, so `parseInbound` stays separate from the text.
 */
export function parseInbound(message) {
  if (message === null || typeof message !== 'object') return null
  // 1 = USER, 2 = BOT. Echoes of our own replies must never be answered.
  if (message.message_type !== 1) return null
  const from = typeof message.from_user_id === 'string' ? message.from_user_id : ''
  if (from === '') return null
  const items = Array.isArray(message.item_list) ? message.item_list : []
  const textParts = items
    .filter((item) => item?.type === 1 && typeof item.text_item?.text === 'string')
    .map((item) => item.text_item.text)
  const text = textParts.join('').trim()
  return {
    userId: from,
    text,
    hasText: text !== '',
    contextToken: typeof message.context_token === 'string' ? message.context_token : '',
    messageId:
      typeof message.message_id === 'number' || typeof message.message_id === 'string'
        ? String(message.message_id)
        : '',
    items: items.length,
  }
}

/** Pull the message array and next cursor out of a getupdates response. */
export function parseUpdates(body) {
  const messages = Array.isArray(body?.msgs) ? body.msgs : []
  const cursor = typeof body?.get_updates_buf === 'string' ? body.get_updates_buf : ''
  return { messages, cursor }
}
