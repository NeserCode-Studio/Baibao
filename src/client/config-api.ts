/** Client side of the consolidation-model setting; talks to the host route. */

export interface ModelChoice {
  provider: string
  providerName: string
  id: string
  name: string
}

export interface ConsolidationSetting {
  provider: string | null
  model: string | null
}

export type ConfigResult =
  | { ok: true; consolidation: ConsolidationSetting; models: ModelChoice[] }
  | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/config'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

function parseResult(body: unknown): ConfigResult {
  if (body === null || typeof body !== 'object') return { ok: false, error: 'bad-response' }
  const record = body as Record<string, unknown>
  if (record.ok !== true) {
    return { ok: false, error: typeof record.error === 'string' ? record.error : 'unknown' }
  }
  const raw = (record.consolidation ?? {}) as Record<string, unknown>
  const models = Array.isArray(record.models)
    ? record.models.flatMap((item) => {
        if (item === null || typeof item !== 'object') return []
        const model = item as Record<string, unknown>
        if (typeof model.id !== 'string' || typeof model.provider !== 'string') return []
        return [
          {
            provider: model.provider,
            providerName: typeof model.providerName === 'string' ? model.providerName : model.provider,
            id: model.id,
            name: typeof model.name === 'string' ? model.name : model.id,
          },
        ]
      })
    : []
  return {
    ok: true,
    consolidation: {
      provider: typeof raw.provider === 'string' ? raw.provider : null,
      model: typeof raw.model === 'string' ? raw.model : null,
    },
    models,
  }
}

export async function getConfig(): Promise<ConfigResult> {
  try {
    const response = await fetch(apiPath(ROUTE), { cache: 'no-store' })
    return parseResult(await response.json())
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function saveConsolidationModel(
  provider: string | null,
  model: string | null,
): Promise<ConfigResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model }),
    })
    return parseResult(await response.json())
  } catch {
    return { ok: false, error: 'network' }
  }
}
