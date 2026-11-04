/** Client read/delete side of Baibao long-term memory. */

export interface MemoryEntry {
  id: string
  kind: 'fact' | 'preference' | 'episode'
  text: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export type MemoryListResult =
  | { ok: true; entries: MemoryEntry[] }
  | { ok: false; error: string }

export type MemoryDeleteResult =
  | { ok: true; deleted: boolean }
  | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/memory'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

export async function listMemory(query = ''): Promise<MemoryListResult> {
  try {
    const search = query === '' ? '' : `?q=${encodeURIComponent(query)}`
    const response = await fetch(apiPath(`${ROUTE}${search}`), { cache: 'no-store' })
    const body = (await response.json()) as {
      ok?: boolean
      entries?: MemoryEntry[]
      error?: string
    }
    if (body.ok === true && Array.isArray(body.entries)) {
      return { ok: true, entries: body.entries }
    }
    return { ok: false, error: body.error ?? `http-${response.status}` }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function deleteMemory(id: string): Promise<MemoryDeleteResult> {
  try {
    const response = await fetch(apiPath(`${ROUTE}?id=${encodeURIComponent(id)}`), {
      method: 'DELETE',
      cache: 'no-store',
    })
    const body = (await response.json()) as {
      ok?: boolean
      deleted?: boolean
      error?: string
    }
    if (body.ok === true && typeof body.deleted === 'boolean') {
      return { ok: true, deleted: body.deleted }
    }
    return { ok: false, error: body.error ?? `http-${response.status}` }
  } catch {
    return { ok: false, error: 'network' }
  }
}
