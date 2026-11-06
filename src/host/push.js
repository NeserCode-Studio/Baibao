/**
 * Push: the in-app inbox and the deterministic gate that decides whether an
 * event may interrupt the user.
 *
 * Two asymmetries are deliberate and load-bearing:
 *
 * 1. Only P0 pierces quiet hours, focus mode and the daily budget. P0 is
 *    reserved for safety, failures and deadlines — the cases where silence is
 *    worse than an interruption.
 * 2. The fallback is always `inbox`, never `notify`. A bug here should
 *    under-notify; it must not spam.
 *
 * `ruleGate` is pure (clock and counters are injected) so the rules stay
 * testable without a real store.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { readConfigData } from './config.js'
import { rootFile } from './paths.js'

const NOTIFICATION_STATUSES = new Set(['unread', 'read', 'dismissed', 'acted'])
const NOTIFICATION_PRIORITIES = new Set(['P0', 'P1', 'P2'])
/** `agent` means the assistant chose to speak up, rather than a trigger firing. */
const NOTIFICATION_SOURCES = new Set(['schedule', 'event', 'webhook', 'manual', 'agent'])

/** Push settings default; overridable through `config.push`. */
export const PUSH_DEFAULTS = {
  enabled: true,
  quietHours: { start: '22:00', end: '08:00' },
  dailyBudget: 3,
  focusMode: false,
}

let pushQueue = Promise.resolve()

function withPushLock(task) {
  const next = pushQueue.then(task, task)
  pushQueue = next.then(
    () => {},
    () => {},
  )
  return next
}

async function notificationsFile() {
  return rootFile('push', 'notifications.json')
}

async function readNotificationData() {
  try {
    const parsed = JSON.parse(await readFile(await notificationsFile(), 'utf8'))
    if (parsed !== null && Array.isArray(parsed.notifications)) {
      return { version: 1, notifications: parsed.notifications }
    }
  } catch {
    // A missing or malformed file starts empty.
  }
  return { version: 1, notifications: [] }
}

async function writeNotificationData(data) {
  const file = await notificationsFile()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

function normalizeNotificationInput(input) {
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (title === '' && body === '') throw new Error('empty-notification')
  return {
    title: title.slice(0, 200),
    body: body.slice(0, 2000),
    priority: NOTIFICATION_PRIORITIES.has(input.priority) ? input.priority : 'P2',
    source: NOTIFICATION_SOURCES.has(input.source) ? input.source : 'manual',
    decision: typeof input.decision === 'string' ? input.decision.slice(0, 40) : 'inbox',
    reason: typeof input.reason === 'string' ? input.reason.slice(0, 500) : '',
    dedupeKey: typeof input.dedupeKey === 'string' ? input.dedupeKey.slice(0, 200) : null,
  }
}

/** Newest-first, optionally filtered by status. */
export async function listNotifications(status = '') {
  const data = await readNotificationData()
  return data.notifications
    .filter((item) => status === '' || item.status === status)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

export async function saveNotification(input) {
  return withPushLock(async () => {
    const data = await readNotificationData()
    const normalized = normalizeNotificationInput(input)
    // Dedupe by key: the same event must not create a second row.
    if (normalized.dedupeKey !== null) {
      const existing = data.notifications.find(
        (item) => item.dedupeKey === normalized.dedupeKey && item.status === 'unread',
      )
      if (existing !== undefined) return existing
    }
    const now = new Date().toISOString()
    const entry = {
      id: `ntf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...normalized,
      status: 'unread',
      feedback: null,
      createdAt: now,
      updatedAt: now,
    }
    data.notifications.push(entry)
    // Keep the file bounded; the inbox is a feed, not an archive.
    if (data.notifications.length > 1000) {
      data.notifications = data.notifications.slice(-1000)
    }
    await writeNotificationData(data)
    return entry
  })
}

export async function updateNotification(id, patch) {
  return withPushLock(async () => {
    const data = await readNotificationData()
    const entry = data.notifications.find((item) => item.id === id)
    if (entry === undefined) return null
    if (typeof patch.status === 'string' && NOTIFICATION_STATUSES.has(patch.status)) {
      entry.status = patch.status
    }
    if (
      patch.feedback === 'useful' ||
      patch.feedback === 'not-useful' ||
      patch.feedback === null
    ) {
      entry.feedback = patch.feedback
    }
    entry.updatedAt = new Date().toISOString()
    await writeNotificationData(data)
    return entry
  })
}

export async function deleteNotification(id) {
  return withPushLock(async () => {
    const data = await readNotificationData()
    const index = data.notifications.findIndex((item) => item.id === id)
    if (index < 0) return false
    data.notifications.splice(index, 1)
    await writeNotificationData(data)
    return true
  })
}

export async function unreadCount() {
  const all = await listNotifications()
  return all.filter((item) => item.status === 'unread').length
}

/** 'HH:mm' -> minutes since midnight, or null when malformed. */
export function parseClock(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * True when `now` falls inside the quiet window.
 *
 * The window may cross midnight (22:00–08:00), so a start greater than the end
 * means "wrap around" rather than "empty window".
 */
export function inQuietHours(now, quietHours) {
  const start = parseClock(quietHours?.start)
  const end = parseClock(quietHours?.end)
  if (start === null || end === null || start === end) return false
  const minutes = now.getHours() * 60 + now.getMinutes()
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end
}

/**
 * Deterministic pre-filter: may this event reach the user, and through which
 * sink?
 *
 * `notifiedToday` and `now` are injected so the rules can be tested without a
 * clock or a real store.
 */
export function ruleGate(event, settings, notifiedToday, now) {
  const config = { ...PUSH_DEFAULTS, ...(settings ?? {}) }
  const priority = NOTIFICATION_PRIORITIES.has(event?.priority) ? event.priority : 'P2'

  if (config.enabled !== true) {
    return { sink: null, reason: 'push-disabled' }
  }
  if (!NOTIFICATION_SOURCES.has(event?.source)) {
    return { sink: null, reason: 'unknown-source' }
  }
  // Informational items never interrupt, so they are settled before the budget
  // is consulted: reporting "over budget" for something that would not have
  // interrupted anyway is a misleading reason.
  if (priority === 'P2') {
    return { sink: 'inbox', reason: 'informational' }
  }
  // P0 is reserved for safety, failure and deadlines: it must not be muted.
  if (priority !== 'P0') {
    if (config.focusMode === true) {
      return { sink: 'inbox', reason: 'focus-mode' }
    }
    if (inQuietHours(now, config.quietHours)) {
      return { sink: 'inbox', reason: 'quiet-hours' }
    }
    const budget = Number.isFinite(config.dailyBudget) ? config.dailyBudget : 0
    if (notifiedToday >= budget) {
      return { sink: 'inbox', reason: 'daily-budget' }
    }
  }
  return { sink: 'notify', reason: 'noteworthy' }
}

/** Push settings from `config.push`, falling back to the defaults. */
export async function readPushSettings() {
  const config = await readConfigData()
  return { ...PUSH_DEFAULTS, ...(config.push ?? {}) }
}

/** Local calendar day, so the daily budget resets at the user's midnight. */
function localDay(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * How many notifications that actually interrupted were sent today.
 *
 * Only `notify` decisions count against the budget; items that merely landed
 * in the inbox were, by definition, not interruptions.
 */
export async function notifiedTodayCount(now = new Date()) {
  const today = localDay(now)
  const all = await listNotifications()
  return all.filter(
    (item) => item.decision === 'notify' && localDay(new Date(item.createdAt)) === today,
  ).length
}

/**
 * Run one candidate through the gate and store it when it may proceed.
 *
 * Returns the decision either way so the caller can explain what happened —
 * a held-back notification is not an error.
 */
export async function deliverNotification(input, now = new Date()) {
  const settings = await readPushSettings()
  const decision = ruleGate(
    { source: input.source ?? 'agent', priority: input.priority },
    settings,
    await notifiedTodayCount(now),
    now,
  )
  if (decision.sink === null) {
    return { delivered: false, sink: 'none', reason: decision.reason, id: null }
  }
  const entry = await saveNotification({
    ...input,
    source: input.source ?? 'agent',
    decision: decision.sink,
    reason: decision.reason,
  })
  return { delivered: true, sink: decision.sink, reason: decision.reason, id: entry.id }
}

/**
 * The `notify_user` tool.
 *
 * The agent decides *whether* something is worth saying, since it holds the
 * whole conversation; `ruleGate` still decides whether now is an acceptable
 * moment. Keeping those two decisions separate means the agent cannot talk
 * itself past quiet hours or the daily budget.
 *
 * The description leans hard on when not to use it: an inbox that pings for
 * everything is worse than no inbox.
 */
export function pushTools() {
  return [
    {
      name: 'notify_user',
      description: [
        'Send the user a short in-app notification when something genuinely needs their attention.',
        'Good reasons: a long task finished with a result they asked for; something failed and needs their decision; a commitment has come due.',
        'Bad reasons: small talk, restating what you just said in this conversation, anything they are already looking at.',
        'When unsure, stay silent — the inbox is only useful if every entry mattered.',
        'This posts to the in-app inbox. Respect quiet hours and the daily budget: the app enforces them, and may hold your message for later.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'One line: what happened.' },
          body: {
            type: 'string',
            description: 'Why it matters now, and what (if anything) the user should do.',
          },
          priority: {
            type: 'string',
            enum: ['P0', 'P1', 'P2'],
            description:
              'P0 only for security, failure or a deadline (it pierces quiet hours). P1 for a decision or commitment. P2 for information that can wait.',
          },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            delivered: { type: 'boolean' },
            sink: { type: 'string' },
            reason: { type: 'string' },
          },
          required: ['delivered', 'sink', 'reason'],
          additionalProperties: false,
        },
        render: (value) => [
          {
            type: 'text',
            text: value.delivered
              ? value.sink === 'notify'
                ? '已通知用户。'
                : '已放入收件箱（当前不宜打断）。'
              : `未发送：${value.reason}`,
          },
        ],
      },
      execute: async (input) => {
        const result = await deliverNotification({
          title: input.title,
          body: input.body,
          // A direct call to this tool already means "worth saying", so the
          // default is a normal notice rather than silent information.
          priority: input.priority ?? 'P1',
          source: 'agent',
        })
        return { delivered: result.delivered, sink: result.sink, reason: result.reason }
      },
    },
  ]
}


