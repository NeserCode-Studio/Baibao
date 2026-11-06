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
import { rootFile } from './paths.js'

const NOTIFICATION_STATUSES = new Set(['unread', 'read', 'dismissed', 'acted'])
const NOTIFICATION_PRIORITIES = new Set(['P0', 'P1', 'P2'])
const NOTIFICATION_SOURCES = new Set(['schedule', 'event', 'webhook', 'manual'])

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
  // Informational items never interrupt.
  if (priority === 'P2') {
    return { sink: 'inbox', reason: 'informational' }
  }
  return { sink: 'notify', reason: 'noteworthy' }
}
