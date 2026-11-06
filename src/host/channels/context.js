/**
 * Which connector a session belongs to.
 *
 * The agent is the same Baibao whichever app the message came from, but it
 * should know where it is talking: answering "I can see this on WeChat" is
 * different from guessing. The mapping is keyed by session id because a person
 * may reach the bot through two connectors, each with its own conversation.
 *
 * Kept in memory: the session's title already records the channel durably (see
 * `agent-bridge`), so this only has to survive while the process does.
 */

/** @typedef {{channel: 'qq'|'wechat', userId: string, label: string}} ChannelContext */

const contexts = new Map()

/** Human-readable name for a connector, used in prompts and titles. */
export const CHANNEL_LABELS = { qq: 'QQ', wechat: '微信' }

export function setChannelContext(sessionId, context) {
  contexts.set(sessionId, context)
}

export function getChannelContext(sessionId) {
  return contexts.get(sessionId) ?? null
}

export function forgetChannelContext(sessionId) {
  contexts.delete(sessionId)
}

/**
 * A short, stable name for a channel conversation.
 *
 * The full platform id is long and meaningless to read; eight characters are
 * enough to tell two people apart in a session list.
 */
export function channelTitle(channel, userId) {
  const label = CHANNEL_LABELS[channel] ?? channel
  const short = userId.length > 8 ? userId.slice(0, 8) : userId
  return `${label} · ${short}`
}
