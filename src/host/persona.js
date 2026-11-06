/**
 * Persona: the Jungian axes, the presets, the consistency audit, and the
 * prompt fragments they produce.
 *
 * The axes are *clarity*, not strength: per MBTI's preference-clarity
 * definition, the number says how consistently one pole was chosen, not how
 * much of a trait someone has. The injected prompt states that explicitly so
 * the model does not read a high score as "more capable".
 *
 * Identity and principles live in `config.persona.text`, edited in the panel.
 * Presets only tilt tone; they must never compete with that text as a source
 * of truth, which is why the preset carries no persona prefix.
 */
import { readConfigData, writeConfigData } from './config.js'

export const DEFAULT_PERSONA_TEXT = [
  '你是百宝，一个独立于其他对话的长期助手。',
  '说话简洁、直接、有温度；先给结论，再给依据；不谄媚，不堆砌。',
  '不确定就说不确定；不伪造能力、文件、命令或记忆。',
  '涉及删除、发布、支付等不可逆操作时，先确认再执行。',
].join('\n')

export const PERSONA_TEXT_LIMIT = 600

export const JUNG_AXES = ['energy', 'information', 'decisions', 'lifestyle']

export const DEFAULT_JUNG = {
  energy: -20,
  information: 20,
  decisions: 30,
  lifestyle: 10,
}

/**
 * A preset is one set of axes plus the style rules it implies.
 *
 * It fills "tendency" and "style hints" only; identity and principles still
 * come from `config.persona.text`.
 */
export const PERSONA_PRESETS = [
  {
    id: 'balanced',
    name: '均衡',
    summary: '先理解，再给判断；多数场景下适用。',
    jung: { energy: -20, information: 20, decisions: 30, lifestyle: 10 },
    style: [
      '先复述对方在意的点，再给结论和依据。',
      '结论先行，但保留一句解释；不确定就说不确定。',
    ],
  },
  {
    id: 'direct',
    name: '直接',
    summary: '结论先行，指出问题，不绕弯。',
    jung: { energy: -10, information: 10, decisions: 90, lifestyle: 70 },
    style: [
      '第一句就给结论或判断，再给依据；不要铺垫。',
      '发现更优解时直接说，并说明代价；不为附和而附和。',
    ],
  },
  {
    id: 'warm',
    name: '温和',
    summary: '先接住情绪，再谈事情；少打断。',
    jung: { energy: 20, information: -10, decisions: 80, lifestyle: -10 },
    style: [
      '先回应对方的处境和情绪，再进入问题本身。',
      '多用「我们可以」，少用「你应该」；提问代替断言。',
    ],
  },
  {
    id: 'quiet',
    name: '安静',
    summary: '少说、想清楚再说；不主动延伸。',
    jung: { energy: -70, information: -20, decisions: -20, lifestyle: -50 },
    style: ['默认短答；只在被问到时展开。', '不主动追加建议、不开无关话题、不重复已知信息。'],
  },
  {
    id: 'partner',
    name: '伙伴',
    summary: '一起把事情往前推；会追问关键约束。',
    jung: { energy: 60, information: 50, decisions: 20, lifestyle: 20 },
    style: [
      '把用户的事当成自己的事：主动追问关键约束，复述下一步。',
      '可以调侃，但不影响信息密度；收尾时列清楚待办。',
    ],
  },
]

export function findPersonaPreset(id) {
  return PERSONA_PRESETS.find((preset) => preset.id === id)
}

export function normalizeJung(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const result = {}
  for (const axis of JUNG_AXES) {
    const raw = source[axis]
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : DEFAULT_JUNG[axis]
    result[axis] = Math.max(-100, Math.min(100, Math.round(value)))
  }
  return result
}

export async function readPersona() {
  const config = await readConfigData()
  const presetId = typeof config.persona?.preset === 'string' ? config.persona.preset : null
  const preset = presetId === null ? null : findPersonaPreset(presetId)
  return { jung: normalizeJung(config.persona?.jung), preset: preset?.id ?? null }
}

export async function writePersona(input) {
  const config = await readConfigData()
  const jung = normalizeJung(input?.jung ?? input)
  // An explicit preset id switches the axes wholesale; `preset: null` keeps the
  // axes but drops the style block, i.e. a hand-tuned persona.
  let presetId = typeof config.persona?.preset === 'string' ? config.persona.preset : null
  if (typeof input?.preset === 'string') {
    presetId = findPersonaPreset(input.preset)?.id ?? null
  } else if (input?.preset === null) {
    presetId = null
  }
  config.persona = { ...config.persona, jung, preset: presetId }
  config.updatedAt = new Date().toISOString()
  await writeConfigData(config)
  return { jung, preset: presetId }
}

/**
 * Clarity band for one axis.
 *
 * Official bands are Slight / Moderate / Clear / Very Clear; Moderate and
 * Clear are the most common, Slight is not rare either.
 */
export function clarityBand(value) {
  const magnitude = Math.abs(value)
  if (magnitude <= 15) return 'slight'
  if (magnitude <= 45) return 'moderate'
  if (magnitude <= 75) return 'clear'
  return 'very-clear'
}

const CLARITY_HINT = {
  slight: '两侧都用，边界模糊，别把任一侧说成定论',
  moderate: '有倾向但不固执，可按情境调整',
  clear: '多数时候如此，例外要说明',
  'very-clear': '一贯如此，可作为稳定默认',
}

const JUNG_DESCRIPTORS = {
  energy: { negative: '内向，先观察再表达', positive: '外向，主动交流' },
  information: { negative: '实感，重视事实与细节', positive: '直觉，重视模式与可能性' },
  decisions: { negative: '思考，先看逻辑一致性', positive: '情感，先照顾人的感受' },
  lifestyle: { negative: '感知，保持开放与探索', positive: '判断，喜欢计划与收束' },
}

const JUNG_LABELS = {
  energy: '能量来源',
  information: '信息获取',
  decisions: '决策方式',
  lifestyle: '生活方式',
}

/**
 * Structural consistency check over the persona configuration.
 *
 * Deterministic on purpose: it asks "will this combination produce a coherent
 * tone", not "is this a good persona". Every note points at a value the user
 * can change.
 */
export function personaAudit(persona) {
  const notes = []
  const jung = persona?.jung ?? {}
  const axes = JUNG_AXES.map((axis) => ({ axis, value: jung[axis] }))
  const extreme = axes.filter((item) => Math.abs(item.value) >= 90)
  const centered = axes.filter((item) => Math.abs(item.value) <= 10)

  if (extreme.length >= 3) {
    notes.push({
      level: 'warn',
      text: `有 ${extreme.length} 个轴接近极值（${extreme.map((item) => JUNG_LABELS[item.axis]).join('、')}），语气会非常单一，建议留出调整空间。`,
    })
  }
  if (centered.length >= 3) {
    notes.push({
      level: 'info',
      text: `有 ${centered.length} 个轴几乎居中（${centered.map((item) => JUNG_LABELS[item.axis]).join('、')}），人格接近默认语气。`,
    })
  }
  // Extremes on opposite axes cancel each other: the prompt ends up asking for
  // both terse and expansive answers in the same turn.
  if (jung.decisions >= 80 && jung.lifestyle >= 80) {
    notes.push({
      level: 'warn',
      text: '决策方式与生活方式同时很高，容易一边要求结论明确、一边要求保留多种可能；建议拉开一侧。',
    })
  }
  if (jung.energy <= -80 && jung.information >= 80) {
    notes.push({
      level: 'info',
      text: '内向与直觉同时很高，表现为想清楚再说但不急于展开；若希望更主动，调高能量来源。',
    })
  }
  if (typeof persona.preset !== 'string' && Math.abs(jung.decisions) <= 10) {
    notes.push({
      level: 'info',
      text: '未选择预设且决策方式居中，回答的直白程度不稳定；可以直接选一个预设作为基准。',
    })
  }
  return notes
}

export function personaPrompt(persona) {
  const lines = ['你的人格倾向（荣格四轴；分数只表示倾向清晰度，不表示强弱）：']
  for (const axis of JUNG_AXES) {
    const value = persona.jung[axis]
    const descriptor =
      value < 0 ? JUNG_DESCRIPTORS[axis].negative : JUNG_DESCRIPTORS[axis].positive
    const band = clarityBand(value)
    lines.push(`- ${JUNG_LABELS[axis]}：偏${descriptor}（清晰度 ${band}：${CLARITY_HINT[band]}）`)
  }
  const preset = typeof persona.preset === 'string' ? findPersonaPreset(persona.preset) : undefined
  if (preset !== undefined) {
    lines.push(`你的人格预设是「${preset.name}」，风格要求：`)
    for (const rule of preset.style) lines.push(`- ${rule}`)
  }
  lines.push('用这些倾向调节语气和判断；不要向用户声明类型标签，也不要把清晰度说成能力高低。')
  return lines.join('\n')
}

export function normalizePersonaText(input) {
  const text = typeof input === 'string' ? input.trim() : DEFAULT_PERSONA_TEXT
  if (text === '') return DEFAULT_PERSONA_TEXT
  return text.slice(0, PERSONA_TEXT_LIMIT)
}

export async function readPersonaText() {
  const config = await readConfigData()
  return normalizePersonaText(config.persona?.text)
}

export async function writePersonaText(input) {
  const config = await readConfigData()
  const text = normalizePersonaText(input?.text)
  config.persona = { ...config.persona, text }
  config.updatedAt = new Date().toISOString()
  await writeConfigData(config)
  return text
}
