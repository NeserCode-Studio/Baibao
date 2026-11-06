/**
 * Channel credentials and the allow-list.
 *
 * Stored in `<root>/config/channels.json` next to the other user-editable
 * state. Secrets are never returned through the API — `maskChannel` exists so
 * the panel can show "configured / not configured" without the value crossing
 * the wire a second time.
 *
 * This is not a vault. Anyone who can read the file can drive the bot, which is
 * why the allow-list below matters more than the secret: even with valid
 * credentials, only listed users may reach the agent.
 */
import { readConfigData, writeConfigData } from '../config.js'

export const CHANNEL_IDS = ['qq', 'wechat']

/** Each channel has its own credential shape; the rest of the fields agree. */
function emptyChannel(id) {
  if (id === 'wechat') {
    return { enabled: false, botToken: '', botId: '', userId: '', allowedUsers: [] }
  }
  return { enabled: false, appId: '', appSecret: '', allowedUsers: [] }
}

function str(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function cleanUsers(value) {
  if (!Array.isArray(value)) return null
  return value
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
    .slice(0, 200)
}

/** Read all channel settings with defaults filled in. */
export async function readChannels() {
  const config = await readConfigData()
  const raw = config.channels ?? {}
  const result = { version: 1 }
  for (const id of CHANNEL_IDS) {
    const entry = raw[id] ?? {}
    const base = emptyChannel(id)
    const users = cleanUsers(entry.allowedUsers)
    if (id === 'wechat') {
      result.wechat = {
        enabled: entry.enabled === true,
        botToken: str(entry.botToken, 1000),
        botId: str(entry.botId, 200),
        userId: str(entry.userId, 200),
        allowedUsers: users ?? [],
      }
      continue
    }
    result.qq = {
      ...base,
      enabled: entry.enabled === true,
      appId: str(entry.appId, 200),
      appSecret: str(entry.appSecret, 500),
      allowedUsers: users ?? [],
    }
  }
  return result
}

/** Persist one channel, keeping the other channels untouched. */
export async function writeChannel(id, patch) {
  if (!CHANNEL_IDS.includes(id)) throw new Error('unknown-channel')
  const config = await readConfigData()
  const channels = { ...(config.channels ?? {}) }
  const current = { ...emptyChannel(id), ...(channels[id] ?? {}) }

  if (typeof patch.enabled === 'boolean') current.enabled = patch.enabled
  if (typeof patch.appId === 'string') current.appId = str(patch.appId, 200)
  // An empty string means "leave the existing secret alone": the panel never
  // receives the real value, so it cannot echo it back.
  if (typeof patch.appSecret === 'string' && patch.appSecret !== '') {
    current.appSecret = str(patch.appSecret, 500)
  }
  if (patch.clearSecret === true) {
    current.appSecret = ''
    current.botToken = ''
  }
  if (typeof patch.botToken === 'string' && patch.botToken !== '') {
    current.botToken = str(patch.botToken, 1000)
  }
  if (typeof patch.botId === 'string') current.botId = str(patch.botId, 200)
  if (typeof patch.userId === 'string') current.userId = str(patch.userId, 200)
  const users = cleanUsers(patch.allowedUsers)
  if (users !== null) current.allowedUsers = users

  channels[id] = current
  config.channels = channels
  config.updatedAt = new Date().toISOString()
  await writeConfigData(config)
  return current
}

/**
 * A channel as the panel should see it: no secret, just whether one exists.
 */
export function maskChannel(id, channel) {
  if (id === 'wechat') {
    return {
      id,
      enabled: channel.enabled === true,
      appId: channel.botId,
      hasSecret: channel.botToken !== '',
      allowedUsers: channel.allowedUsers,
      configured: channel.botToken !== '',
    }
  }
  return {
    id,
    enabled: channel.enabled === true,
    appId: channel.appId,
    hasSecret: channel.appSecret !== '',
    allowedUsers: channel.allowedUsers,
    // Ready to connect only when every required piece is present.
    configured: channel.appId !== '' && channel.appSecret !== '',
  }
}

/**
 * Whether a sender may talk to the agent.
 *
 * An empty allow-list denies everyone rather than allowing everyone: the bot
 * has file and terminal tools, so "open by default" would hand shell access to
 * anyone who finds it.
 */
export function isUserAllowed(channel, openid) {
  if (channel === null || channel === undefined) return false
  if (!Array.isArray(channel.allowedUsers) || channel.allowedUsers.length === 0) return false
  return channel.allowedUsers.includes(openid)
}

/**
 * The same person on two platforms.
 *
 * Without an explicit link the agent cannot tell that the QQ contact and the
 * WeChat contact are one person, so it treats them as strangers and answers
 * "I have no conversation with you there". Binding them is a deliberate act
 * because guessing from allow-lists would merge two different people.
 *
 * The panel shows masked forms only; these ids are long and reveal nothing
 * useful when printed in full.
 */
export async function readIdentity() {
  const config = await readConfigData()
  const raw = config.identity ?? {}
  return {
    qq: typeof raw.qq === 'string' ? raw.qq : '',
    wechat: typeof raw.wechat === 'string' ? raw.wechat : '',
  }
}

export async function writeIdentity(patch) {
  const config = await readConfigData()
  const current = { ...(config.identity ?? {}) }
  if (typeof patch.qq === 'string') current.qq = patch.qq.trim().slice(0, 200)
  if (typeof patch.wechat === 'string') current.wechat = patch.wechat.trim().slice(0, 200)
  config.identity = current
  config.updatedAt = new Date().toISOString()
  await writeConfigData(config)
  return { qq: current.qq ?? '', wechat: current.wechat ?? '' }
}

/** Enough of an id to recognise it, not enough to be worth copying. */
function maskId(value) {
  if (typeof value !== 'string' || value === '') return ''
  if (value.length <= 6) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 4)}****${value.slice(-3)}`
}

export function maskIdentity(identity) {
  return {
    qq: maskId(identity?.qq),
    wechat: maskId(identity?.wechat),
    bound: (identity?.qq ?? '') !== '' && (identity?.wechat ?? '') !== '',
  }
}

/** The other platform's id for this sender, when the pair is bound. */
export async function counterpartOf(channel, userId) {
  const identity = await readIdentity()
  if (identity.qq === '' || identity.wechat === '') return null
  if (channel === 'qq' && identity.qq === userId && identity.wechat !== '') {
    return { channel: 'wechat', userId: identity.wechat }
  }
  if (channel === 'wechat' && identity.wechat === userId && identity.qq !== '') {
    return { channel: 'qq', userId: identity.qq }
  }
  return null
}
