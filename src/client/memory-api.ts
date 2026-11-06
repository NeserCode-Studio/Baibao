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
  | {
      ok: true
      entries: MemoryEntry[]
      total: number
      page: number
      pageSize: number
      pageCount: number
    }
  | { ok: false; error: string }

export type MemoryDeleteResult =
  | { ok: true; deleted: boolean }
  | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/memory'

export const MEMORY_PAGE_SIZE = 10

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

export async function listMemory(
  query = '',
  page = 1,
  pageSize = MEMORY_PAGE_SIZE,
): Promise<MemoryListResult> {
  try {
    const params = new URLSearchParams()
    if (query !== '') params.set('q', query)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const response = await fetch(apiPath(`${ROUTE}?${params.toString()}`), { cache: 'no-store' })
    const body = (await response.json()) as {
      ok?: boolean
      entries?: MemoryEntry[]
      total?: number
      page?: number
      pageSize?: number
      pageCount?: number
      error?: string
    }
    if (body.ok === true && Array.isArray(body.entries)) {
      return {
        ok: true,
        entries: body.entries,
        total: typeof body.total === 'number' ? body.total : body.entries.length,
        page: typeof body.page === 'number' ? body.page : page,
        pageSize: typeof body.pageSize === 'number' ? body.pageSize : pageSize,
        pageCount: typeof body.pageCount === 'number' ? body.pageCount : 1,
      }
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
