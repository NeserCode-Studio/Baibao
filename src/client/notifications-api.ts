/** Client read/write side of the Baibao push inbox. */

export type NotificationPriority = 'P0' | 'P1' | 'P2'
export type NotificationStatus = 'unread' | 'read' | 'dismissed' | 'acted'
export type NotificationFeedback = 'useful' | 'not-useful' | null

export interface NotificationEntry {
  id: string
  title: string
  body: string
  priority: NotificationPriority
  source: string
  decision: string
  reason: string
  status: NotificationStatus
  feedback: NotificationFeedback
  createdAt: string
  updatedAt: string
}

export type NotificationListResult =
  | {
      ok: true
      entries: NotificationEntry[]
      total: number
      page: number
      pageSize: number
      pageCount: number
      unread: number
    }
  | { ok: false; error: string }

export type NotificationWriteResult =
  | { ok: true; entry: NotificationEntry; unread: number }
  | { ok: false; error: string }

export const NOTIFICATION_PAGE_SIZE = 20

const ROUTE = '/dsh-baibao/api/notifications'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

function parseEntry(value: unknown): NotificationEntry | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  return {
    id: record.id,
    title: typeof record.title === 'string' ? record.title : '',
    body: typeof record.body === 'string' ? record.body : '',
    priority:
      record.priority === 'P0' || record.priority === 'P1' || record.priority === 'P2'
        ? record.priority
        : 'P2',
    source: typeof record.source === 'string' ? record.source : 'manual',
    decision: typeof record.decision === 'string' ? record.decision : '',
    reason: typeof record.reason === 'string' ? record.reason : '',
    status:
      record.status === 'read' ||
      record.status === 'dismissed' ||
      record.status === 'acted' ||
      record.status === 'unread'
        ? record.status
        : 'unread',
    feedback:
      record.feedback === 'useful' || record.feedback === 'not-useful' ? record.feedback : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
  }
}

export async function listNotifications(
  status = '',
  page = 1,
  pageSize = NOTIFICATION_PAGE_SIZE,
): Promise<NotificationListResult> {
  try {
    const params = new URLSearchParams()
    if (status !== '') params.set('status', status)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const response = await fetch(apiPath(`${ROUTE}?${params.toString()}`), { cache: 'no-store' })
    const body = (await response.json()) as {
      ok?: boolean
      entries?: unknown[]
      total?: number
      page?: number
      pageSize?: number
      pageCount?: number
      unread?: number
      error?: string
    }
    if (body.ok !== true || !Array.isArray(body.entries)) {
      return { ok: false, error: body.error ?? `http-${response.status}` }
    }
    return {
      ok: true,
      entries: body.entries.flatMap((item) => {
        const entry = parseEntry(item)
        return entry === null ? [] : [entry]
      }),
      total: typeof body.total === 'number' ? body.total : 0,
      page: typeof body.page === 'number' ? body.page : page,
      pageSize: typeof body.pageSize === 'number' ? body.pageSize : pageSize,
      pageCount: typeof body.pageCount === 'number' ? body.pageCount : 1,
      unread: typeof body.unread === 'number' ? body.unread : 0,
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function createNotification(input: {
  title: string
  body: string
  priority?: NotificationPriority
  source?: string
}): Promise<NotificationWriteResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    const body = (await response.json()) as {
      ok?: boolean
      entry?: unknown
      unread?: number
      error?: string
    }
    const entry = parseEntry(body.entry)
    if (body.ok !== true || entry === null) {
      return { ok: false, error: body.error ?? `http-${response.status}` }
    }
    return { ok: true, entry, unread: typeof body.unread === 'number' ? body.unread : 0 }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function updateNotification(
  id: string,
  patch: { status?: NotificationStatus; feedback?: NotificationFeedback },
): Promise<NotificationWriteResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'PATCH',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    const body = (await response.json()) as {
      ok?: boolean
      entry?: unknown
      unread?: number
      error?: string
    }
    const entry = parseEntry(body.entry)
    if (body.ok !== true || entry === null) {
      return { ok: false, error: body.error ?? `http-${response.status}` }
    }
    return { ok: true, entry, unread: typeof body.unread === 'number' ? body.unread : 0 }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function deleteNotification(
  id: string,
): Promise<{ ok: true; unread: number } | { ok: false; error: string }> {
  try {
    const response = await fetch(apiPath(`${ROUTE}?id=${encodeURIComponent(id)}`), {
      method: 'DELETE',
      cache: 'no-store',
    })
    const body = (await response.json()) as { ok?: boolean; unread?: number; error?: string }
    if (body.ok !== true) return { ok: false, error: body.error ?? `http-${response.status}` }
    return { ok: true, unread: typeof body.unread === 'number' ? body.unread : 0 }
  } catch {
    return { ok: false, error: 'network' }
  }
}
