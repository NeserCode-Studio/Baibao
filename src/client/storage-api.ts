/** Client side of the storage-location setting; talks to the host route. */

export interface StorageInfo {
  root: string
  defaultRoot: string
  configured: boolean
  memoryDir: string
  configDir: string
  configFile: string
  exists: boolean
  writable: boolean
}

export interface StorageMigration {
  from: string
  to: string
  files: number
  backups: number
  keptOld: boolean
}

export type StorageResult =
  | { ok: true; storage: StorageInfo; migration?: StorageMigration }
  | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/storage'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

async function readResult(response: Response): Promise<StorageResult> {
  try {
    const body = (await response.json()) as {
      ok?: boolean
      storage?: StorageInfo
      migration?: StorageMigration
      error?: string
    }
    if (body.ok === true && body.storage !== undefined) {
      return { ok: true, storage: body.storage, migration: body.migration }
    }
    return { ok: false, error: body.error ?? `http-${response.status}` }
  } catch {
    return { ok: false, error: `http-${response.status}` }
  }
}

export async function getStorage(): Promise<StorageResult> {
  try {
    const response = await fetch(apiPath(ROUTE), { cache: 'no-store' })
    return await readResult(response)
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function setStorage(root: string): Promise<StorageResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root }),
    })
    return await readResult(response)
  } catch {
    return { ok: false, error: 'network' }
  }
}
