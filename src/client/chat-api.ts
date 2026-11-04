/** Client entry for starting a native Baibao conversation. */

export interface StartChatResult {
  ok: boolean
  sessionId?: string
  workspace?: { id: string; path: string; title: string }
  error?: string
}

const ROUTE = '/dsh-baibao/api/chat/start'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

export async function startBaibaoChat(): Promise<StartChatResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
    })
    const body = (await response.json()) as StartChatResult
    if (body.ok === true && typeof body.sessionId === 'string') return body
    return { ok: false, error: body.error ?? `http-${response.status}` }
  } catch {
    return { ok: false, error: 'network' }
  }
}
