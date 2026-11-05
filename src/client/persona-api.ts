/** Client read/write side of the Jungian persona tuning. */

export type JungAxis = 'energy' | 'information' | 'decisions' | 'lifestyle'

export type JungPersona = Record<JungAxis, number>

export const DEFAULT_JUNG: JungPersona = {
  energy: -20,
  information: 20,
  decisions: 30,
  lifestyle: 10,
}

/** Mirrors the host fallback until the real default arrives from GET. */
export const DEFAULT_JUNG_TEXT = [
  '你是百宝，一个独立于其他对话的长期助手。',
  '说话简洁、直接、有温度；先给结论，再给依据；不谄媚，不堆砌。',
  '不确定就说不确定；不伪造能力、文件、命令或记忆。',
  '涉及删除、发布、支付等不可逆操作时，先确认再执行。',
].join('\n')

/** One selectable personality preset; axes plus the style rules it implies. */
export interface PersonaPreset {
  id: string
  name: string
  summary: string
  jung: JungPersona
  style: string[]
}

/** One structural note about the current persona configuration. */
export interface PersonaAuditNote {
  level: 'warn' | 'info'
  text: string
}

export type PersonaResult =
  | {
      ok: true
      persona: JungPersona
      preset: string | null
      text: string
      defaultText: string
      limit: number
      presets: PersonaPreset[]
      audit: PersonaAuditNote[]
    }
  | { ok: false; error: string }

const ROUTE = '/dsh-baibao/api/persona'

function apiPath(path: string): string {
  const relative = path.replace(/^\/+/, '')
  if (typeof document === 'undefined') return `/${relative}`
  const url = new URL(relative, document.baseURI)
  return `${url.pathname}${url.search}`
}

function normalize(value: unknown): JungPersona {
  const outer = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const source = (outer.jung !== null && typeof outer.jung === 'object'
    ? outer.jung
    : outer) as Record<string, unknown>
  const result = {} as JungPersona
  for (const axis of Object.keys(DEFAULT_JUNG) as JungAxis[]) {
    const raw = source[axis]
    const number = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_JUNG[axis]
    result[axis] = Math.max(-100, Math.min(100, Math.round(number)))
  }
  return result
}

function normalizePresets(value: unknown): PersonaPreset[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || typeof record.name !== 'string') return []
    return [
      {
        id: record.id,
        name: record.name,
        summary: typeof record.summary === 'string' ? record.summary : '',
        jung: normalize(record.jung),
        style: Array.isArray(record.style)
          ? record.style.filter((rule): rule is string => typeof rule === 'string')
          : [],
      },
    ]
  })
}

function normalizeAudit(value: unknown): PersonaAuditNote[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.text !== 'string') return []
    return [{ level: record.level === 'warn' ? 'warn' : 'info', text: record.text }]
  })
}

function parseResult(body: Record<string, unknown>): PersonaResult {
  if (body.ok !== true) {
    return { ok: false, error: typeof body.error === 'string' ? body.error : 'unknown' }
  }
  const persona = (body.persona ?? body.jung) as unknown
  return {
    ok: true,
    persona: normalize(persona),
    preset: typeof body.preset === 'string' ? body.preset : null,
    text: typeof body.text === 'string' ? body.text : DEFAULT_JUNG_TEXT,
    defaultText: typeof body.defaultText === 'string' ? body.defaultText : DEFAULT_JUNG_TEXT,
    limit: typeof body.limit === 'number' ? body.limit : 600,
    presets: normalizePresets(body.presets),
    audit: normalizeAudit(body.audit),
  }
}

export async function getPersona(): Promise<PersonaResult> {
  try {
    const response = await fetch(apiPath(ROUTE), { cache: 'no-store' })
    return parseResult((await response.json()) as Record<string, unknown>)
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function savePersona(
  persona: JungPersona,
  text?: string,
  preset?: string | null,
): Promise<PersonaResult> {
  try {
    const response = await fetch(apiPath(ROUTE), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jung: normalize(persona),
        ...(text === undefined ? {} : { text }),
        ...(preset === undefined ? {} : { preset }),
      }),
    })
    return parseResult((await response.json()) as Record<string, unknown>)
  } catch {
    return { ok: false, error: 'network' }
  }
}
