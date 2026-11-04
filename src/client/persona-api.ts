/** Client read/write side of the Jungian persona tuning. */

export type JungAxis = 'energy' | 'information' | 'decisions' | 'lifestyle'

export type JungPersona = Record<JungAxis, number>

export const DEFAULT_JUNG: JungPersona = {
  energy: -20,
  information: 20,
  decisions: 30,
  lifestyle: 10,
}

export type PersonaResult =
  | { ok: true; persona: JungPersona }
  | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/persona'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

function normalize(value: unknown): JungPersona {
  const source = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const result = {} as JungPersona
  for (const axis of Object.keys(DEFAULT_JUNG) as JungAxis[]) {
    const raw = source[axis]
    const number = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_JUNG[axis]
    result[axis] = Math.max(-100, Math.min(100, Math.round(number)))
  }
  return result
}

export async function getPersona(): Promise<PersonaResult> {
  try {
    const response = await fetch(apiPath(ROUTE), { cache: 'no-store' })
    const body = (await response.json()) as { ok?: boolean; persona?: unknown; error?: string }
    if (body.ok === true) return { ok: true, persona: normalize(body.persona) }
    return { ok: false, error: body.error ?? `http-${response.status}` }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function savePersona(persona: JungPersona): Promise<PersonaResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jung: normalize(persona) }),
    })
    const body = (await response.json()) as { ok?: boolean; persona?: unknown; error?: string }
    if (body.ok === true) return { ok: true, persona: normalize(body.persona) }
    return { ok: false, error: body.error ?? `http-${response.status}` }
  } catch {
    return { ok: false, error: 'network' }
  }
}
