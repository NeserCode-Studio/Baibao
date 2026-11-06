/**
 * Channel credentials and the allow-list.
 *
 * Stored in `<root>/config/channels.json` next to the other user-editable
 * state. The secret is never returned through the API — `maskChannel` exists so
 * the panel can show "configured / not configured" without the value crossing
 * the wire a second time.
 *
 * This is not a vault. Anyone who can read the file can drive the bot, which is
 * why the allow-list below matters more than the secret: even with valid
 * credentials, only listed users may reach the agent.
 */
import { readConfigData, writeConfigData } from '../config.js'

const CHANNEL_IDS = ['qq']

function emptyChannel() {
  return { enabled: false, appId: '', appSecret: '', allowedUsers: [] }
}

/** Read all channel settings with defaults filled in. */
export async function readChannels() {
  const config = await readConfigData()
  const raw = config.channels ?? {}
  const result = { version: 1 }
  for (const id of CHANNEL_IDS) {
    const entry = raw[id] ?? {}
    result[id] = {
      enabled: entry.enabled === true,
      appId: typeof entry.appId === 'string' ? entry.appId : '',
      appSecret: typeof entry.appSecret === 'string' ? entry.appSecret : '',
      allowedUsers: Array.isArray(entry.allowedUsers)
        ? entry.allowedUsers.filter((item) => typeof item === 'string' && item !== '').slice(0, 200)
        : [],
    }
  }
  return result
}

/** Persist one channel, keeping the other channels untouched. */
export async function writeChannel(id, patch) {
  if (!CHANNEL_IDS.includes(id)) throw new Error('unknown-channel')
  const config = await readConfigData()
  const channels = { ...(config.channels ?? {}) }
  const current = { ...emptyChannel(), ...(channels[id] ?? {}) }

  if (typeof patch.enabled === 'boolean') current.enabled = patch.enabled
  if (typeof patch.appId === 'string') current.appId = patch.appId.trim().slice(0, 200)
  // An empty string means "leave the existing secret alone": the panel never
  // receives the real value, so it cannot echo it back.
  if (typeof patch.appSecret === 'string' && patch.appSecret !== '') {
    current.appSecret = patch.appSecret.trim().slice(0, 500)
  }
  if (patch.clearSecret === true) current.appSecret = ''
  if (Array.isArray(patch.allowedUsers)) {
    current.allowedUsers = patch.allowedUsers
      .filter((item) => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.trim())
      .slice(0, 200)
  }

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
