/** Client side of the channel connections. */

export interface ChannelInfo {
  id: string
  enabled: boolean
  appId: string
  hasSecret: boolean
  allowedUsers: string[]
  configured: boolean
}

export interface ChannelStatusEntry {
  state: string
  detail?: string
}

export type ChannelsResult =
  | {
      ok: true
      channels: ChannelInfo[]
      status: Record<string, ChannelStatusEntry>
    }
  | { ok: false; error: string }

export type ChannelSaveResult =
  | { ok: true; channel: ChannelInfo; channels: ChannelInfo[] }
  | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/channels'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

function parseChannel(value: unknown): ChannelInfo | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string') return null
  return {
    id: record.id,
    enabled: record.enabled === true,
    appId: typeof record.appId === 'string' ? record.appId : '',
    hasSecret: record.hasSecret === true,
    allowedUsers: Array.isArray(record.allowedUsers)
      ? record.allowedUsers.filter((item): item is string => typeof item === 'string')
      : [],
    configured: record.configured === true,
  }
}

function parseChannels(value: unknown): ChannelInfo[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const parsed = parseChannel(item)
    return parsed === null ? [] : [parsed]
  })
}

function parseStatus(value: unknown): Record<string, ChannelStatusEntry> {
  if (value === null || typeof value !== 'object') return {}
  const result: Record<string, ChannelStatusEntry> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    result[key] = {
      state: typeof record.state === 'string' ? record.state : 'unknown',
      detail: typeof record.detail === 'string' ? record.detail : undefined,
    }
  }
  return result
}

export async function getChannels(): Promise<ChannelsResult> {
  try {
    const response = await fetch(apiPath(ROUTE), { cache: 'no-store' })
    const body = (await response.json()) as {
      ok?: boolean
      channels?: unknown
      status?: unknown
      error?: string
    }
    if (body.ok !== true) return { ok: false, error: body.error ?? `http-${response.status}` }
    return {
      ok: true,
      channels: parseChannels(body.channels),
      status: parseStatus(body.status),
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function saveChannel(
  id: string,
  patch: {
    enabled?: boolean
    appId?: string
    appSecret?: string
    clearSecret?: boolean
    allowedUsers?: string[]
    botToken?: string
  },
): Promise<ChannelSaveResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    const body = (await response.json()) as {
      ok?: boolean
      channel?: unknown
      channels?: unknown
      error?: string
    }
    const channel = parseChannel(body.channel)
    if (body.ok !== true || channel === null) {
      return { ok: false, error: body.error ?? `http-${response.status}` }
    }
    return { ok: true, channel, channels: parseChannels(body.channels) }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export interface QrState {
  status: string
  done: boolean
  expired: boolean
  botId: string
}

export interface QrCode {
  qrcode: string
  /** data URL of the rendered QR, empty when encoding failed. */
  image: string
  /** The raw login URL, shown as a fallback link. */
  url: string
}

export type QrResult = { ok: true; qr: QrCode } | { ok: false; error: string }
export type QrPollResult =
  | { ok: true; state: QrState; channels?: ChannelInfo[] }
  | { ok: false; error: string }

/** Ask the platform for a fresh login QR code. */
export async function requestWechatQr(): Promise<QrResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'wechat', action: 'qr' }),
    })
    const body = (await response.json()) as {
      ok?: boolean
      qr?: { qrcode?: unknown; image?: unknown; url?: unknown }
      error?: string
    }
    if (body.ok !== true || typeof body.qr?.qrcode !== 'string') {
      return { ok: false, error: body.error ?? `http-${response.status}` }
    }
    return {
      ok: true,
      qr: {
        qrcode: body.qr.qrcode,
        image: typeof body.qr.image === 'string' ? body.qr.image : '',
        url: typeof body.qr.url === 'string' ? body.qr.url : '',
      },
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}

/** Poll one login attempt. */
export async function pollWechatQr(qrcode: string): Promise<QrPollResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'wechat', action: 'poll', qrcode }),
    })
    const body = (await response.json()) as {
      ok?: boolean
      state?: { status?: unknown; done?: unknown; expired?: unknown; botId?: unknown }
      channels?: unknown
      error?: string
    }
    if (body.ok !== true) return { ok: false, error: body.error ?? `http-${response.status}` }
    return {
      ok: true,
      state: {
        status: typeof body.state?.status === 'string' ? body.state.status : 'unknown',
        done: body.state?.done === true,
        expired: body.state?.expired === true,
        botId: typeof body.state?.botId === 'string' ? body.state.botId : '',
      },
      channels: Array.isArray(body.channels) ? parseChannels(body.channels) : undefined,
    }
  } catch {
    return { ok: false, error: 'network' }
  }
}
