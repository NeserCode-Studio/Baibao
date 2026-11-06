/** Client side of the push settings. */

export interface PushSettings {
  enabled: boolean
  focusMode: boolean
  dailyBudget: number
  quietHours: { start: string; end: string }
}

export interface PushState {
  settings: PushSettings
  notifiedToday: number
  defaults: PushSettings
}

export type PushResult = ({ ok: true } & PushState) | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/push'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

function clock(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback
}

function parseSettings(value: unknown, fallback: PushSettings): PushSettings {
  if (value === null || typeof value !== 'object') return fallback
  const record = value as Record<string, unknown>
  const hours = (record.quietHours ?? {}) as Record<string, unknown>
  const budget = Number(record.dailyBudget)
  return {
    enabled: record.enabled === true,
    focusMode: record.focusMode === true,
    dailyBudget: Number.isFinite(budget) ? budget : fallback.dailyBudget,
    quietHours: {
      start: clock(hours.start, fallback.quietHours.start),
      end: clock(hours.end, fallback.quietHours.end),
    },
  }
}

const FALLBACK: PushSettings = {
  enabled: true,
  focusMode: false,
  dailyBudget: 3,
  quietHours: { start: '22:00', end: '08:00' },
}

function parseState(body: {
  settings?: unknown
  notifiedToday?: unknown
  defaults?: unknown
}): PushState {
  const defaults = parseSettings(body.defaults, FALLBACK)
  return {
    settings: parseSettings(body.settings, defaults),
    notifiedToday: Number.isFinite(Number(body.notifiedToday)) ? Number(body.notifiedToday) : 0,
    defaults,
  }
}

export async function getPush(): Promise<PushResult> {
  try {
    const response = await fetch(apiPath(ROUTE), { cache: 'no-store' })
    const body = (await response.json()) as {
      ok?: boolean
      settings?: unknown
      notifiedToday?: unknown
      defaults?: unknown
      error?: string
    }
    if (body.ok !== true) return { ok: false, error: body.error ?? `http-${response.status}` }
    return { ok: true, ...parseState(body) }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function savePush(patch: Partial<PushSettings>): Promise<PushResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const body = (await response.json()) as {
      ok?: boolean
      settings?: unknown
      notifiedToday?: unknown
      defaults?: unknown
      error?: string
    }
    if (body.ok !== true) return { ok: false, error: body.error ?? `http-${response.status}` }
    return { ok: true, ...parseState(body) }
  } catch {
    return { ok: false, error: 'network' }
  }
}
