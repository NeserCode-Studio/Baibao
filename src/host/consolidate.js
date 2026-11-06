/**
 * Turning a conversation into durable memory.
 *
 * Two extractors live here. The LLM one follows the contract S6 verified; the
 * heuristic one is the fallback so the explicit-memory loop keeps working when
 * no model is configured or the call fails. Consolidation must never block or
 * break a turn.
 *
 * Two constraints come straight from the S6 measurements, not guesswork:
 * - the model drifted to English once in ten runs, so the language is pinned in
 *   the prompt and every extracted text is CJK-checked before it can be stored;
 * - `confidence` was 0.9–0.95 for almost every entry, so it is ignored and
 *   trust is assigned by provenance instead (see `SOURCE_TRUST`).
 */
import { readConfigData } from './config.js'
import {
  MEMORY_KINDS,
  listMemory,
  normalizeMemoryText,
  saveMemory,
  searchMemory,
} from './memory.js'
import { normalizePath } from './paths.js'

const CONSOLIDATION_INSTRUCTION = [
  '你是百宝的记忆整理器。从对话中提取关于用户的**长期**事实。',
  '',
  '只输出 JSON，不要解释，不要 Markdown 代码围栏：',
  '{"facts":[{"text":"一句独立完整的话","kind":"fact|preference","tags":["可选标签"]}]}',
  '没有值得记住的内容时输出 {"facts":[]}。',
  '',
  '规则：',
  '- 所有 text 必须用简体中文，不要翻译成英文。',
  '- 只记跨会话仍然成立的信息：身份、稳定偏好、长期在做的项目、明确约定。',
  '- 不要记一次性请求、当前任务的中间状态、助手自己的回复内容。',
  '- 每条 text 独立成句，不依赖上下文也能读懂。',
  '- 最多 8 条，挑最重要的。',
].join('\n')

/** Provenance-based trust; the model's own confidence is not used (see S6). */
const SOURCE_TRUST = {
  'user-explicit': 0.95,
  'agent-inferred': 0.6,
}

/** A stored entry may carry provenance; older entries default to inferred. */
export function trustOf(entry) {
  const source = typeof entry?.source === 'string' ? entry.source : null
  return source === null ? SOURCE_TRUST['agent-inferred'] : (SOURCE_TRUST[source] ?? 0.6)
}

export function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(text)
}

/**
 * Pull text out of a message record.
 *
 * Committed events nest the message one level down
 * (`{ message: { content: [...] } }`); older shapes put it at the root, so both
 * are accepted.
 */
export function messageText(data) {
  const message = data?.message ?? data
  if (typeof message?.text === 'string') return message.text
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
}

/**
 * Rule-based extraction over one message.
 *
 * Deliberately narrow: only explicit instructions, stated preferences,
 * boundaries, and stable first-person attributes ("我的猫叫年糕"). Everything
 * else is left to the LLM extractor rather than guessed at.
 */
export function extractMemoryCandidate(text) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (cleaned === '') return null
  const explicit = cleaned.match(/(?:记住|记一下|记下来|记下)[：:，,\s]*([^。！？!?\n]{4,160})/)
  const preference = cleaned.match(
    /(我(?:喜欢|偏好|讨厌|不喜欢|希望|想要|习惯|总是|通常)[^。！？!?\n]{2,160})/,
  )
  // Stable first-person facts: "我的猫叫年糕", "我的项目代号是百宝". These are
  // the L1 statements the memory design asks for; without them only explicit
  // instructions and stated preferences ever reach the store.
  const attribute = cleaned.match(
    /(我(?:的|们的是|家|目前在|现在在|做的是)[^。！？!?\n]{1,40}(?:是|叫|为|属于)[^。！？!?\n]{2,120})/,
  )
  const boundary = cleaned.match(/((?:不要|别)[^。！？!?\n]{2,160})/)
  const raw = (explicit?.[1] ?? preference?.[1] ?? attribute?.[1] ?? boundary?.[1])?.trim()
  if (raw === undefined || raw.length < 4) return null
  const value = raw.replace(/[。！？!?]+$/, '').trim()
  const kind = /喜欢|偏好|讨厌|不喜欢|希望|想要|习惯|不要|别/.test(value) ? 'preference' : 'fact'
  return { text: value, kind, tags: ['auto'] }
}

const lastConsolidatedTurns = new Map()

/** True when the agent's session lives in the Baibao workspace. */
export function isBaibaoAgent(agent, workspacePath) {
  if (workspacePath === null) return false
  const cwd = agent?.session?.header?.cwd
  if (typeof cwd !== 'string') return false
  return normalizePath(cwd) === normalizePath(workspacePath)
}

/**
 * Recent durable events of this agent's session.
 *
 * `sessionQuery` has no `readSurface` — calling it threw, and the catch below
 * turned every recall into a silent no-op. `sessionController.page` is the
 * documented read: it takes a SessionAddress and returns committed records.
 */
async function readSessionRecords(ctx, agent, maxMessages) {
  const controller = ctx.get('sessionController')
  if (controller === undefined || typeof controller.page !== 'function') return []
  try {
    const page = await controller.page(
      { address: { kind: 'session', sessionId: agent.id }, maxMessages },
      AbortSignal.timeout(10_000),
    )
    return Array.isArray(page?.records) ? page.records : []
  } catch {
    return []
  }
}

/** Latest user message of the current turn, or null when unavailable. */
export async function readLatestUserMessage(ctx, agent) {
  const records = await readSessionRecords(ctx, agent, 20)
  const users = records.filter((record) => record?.event?.type === 'user/message')
  const latest = users[users.length - 1]
  if (latest === undefined) return null
  const text = messageText(latest.event?.data).trim()
  return text === '' ? null : text
}

/** Newest-first user messages of this agent's surface, capped. */
export async function readRecentUserMessages(ctx, agent, limit = 6) {
  const records = await readSessionRecords(ctx, agent, 40)
  const users = records.filter((record) => record?.event?.type === 'user/message')
  return users
    .slice(-limit)
    .map((record) => messageText(record.event?.data).trim())
    .filter((text) => text !== '')
    .reverse()
}

export function renderMemoryContext(entries) {
  const lines = entries.slice(0, 12).map((entry) => {
    const text = String(entry.text ?? '').replace(/\s+/g, ' ').trim()
    const clipped = text.length > 180 ? `${text.slice(0, 179)}…` : text
    return `- [${entry.kind}] ${clipped}`
  })
  return [
    '以下是从百宝长期记忆里召回的条目，可能相关也可能过时。',
    '只在确实相关时使用；需要更多时调用 memory_search；不要向用户机械复述全部记忆。',
    ...lines,
  ].join('\n')
}

/**
 * Refresh the memory section from a query.
 *
 * Falls back to the recent list when the query yields nothing, so a turn about
 * something unrelated still gets the same context a fresh agent would.
 */
export async function refreshMemorySection(agentCtx, query) {
  const results = query === '' ? [] : await searchMemory(query, 8)
  const entries = results.length > 0 ? results : await listMemory()
  if (entries.length === 0) return
  try {
    agentCtx.systemPrompt.section({
      name: 'baibao-memory-context',
      order: 60,
      text: renderMemoryContext(entries),
    })
  } catch {
    // A resumed agent may already own the section in this scope.
  }
}

/**
 * Consolidation model settings.
 *
 * Defaults to null rather than a hardcoded model: `llm.stream` requires a real
 * provider id (S6), so an unset value means "decline" and the heuristic
 * extractor runs instead.
 */
export async function readConsolidationModel() {
  const config = await readConfigData()
  const memory = config.memory ?? {}
  const provider =
    typeof memory.consolidationProvider === 'string' ? memory.consolidationProvider : null
  const model = typeof memory.consolidationModel === 'string' ? memory.consolidationModel : null
  return { provider, model }
}

/** Strip an optional code fence, then parse. Returns null when unusable. */
export function parseConsolidationReply(raw) {
  if (typeof raw !== 'string') return null
  const unfenced = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed
  try {
    parsed = JSON.parse(unfenced)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.facts)) return null
  const facts = []
  for (const item of parsed.facts) {
    if (item === null || typeof item !== 'object') continue
    const text = typeof item.text === 'string' ? item.text.trim() : ''
    if (text === '' || text.length > 400) continue
    // S6 saw one English reply in ten; drop non-Chinese text rather than let
    // the store become a mix of languages.
    if (!hasCjk(text)) continue
    const kind = MEMORY_KINDS.has(item.kind) ? item.kind : 'fact'
    const tags = Array.isArray(item.tags)
      ? item.tags.filter((tag) => typeof tag === 'string' && tag.trim() !== '').slice(0, 6)
      : []
    facts.push({ text, kind, tags })
    if (facts.length >= 8) break
  }
  return facts
}

/**
 * Call `llm.stream` and return the consolidated facts, or null when the model
 * is unavailable or the reply is unusable.
 *
 * The API shape here is what S6 verified; see plan-tech/spikes.md §S6.
 */
export async function extractFactsWithLlm(ctx, conversation, options = {}) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') return null
  // `llm.stream` rejects a missing provider with NO_ADAPTER (S6), so an unset
  // model means "decline" rather than "try and fail".
  const provider = typeof options.provider === 'string' ? options.provider : null
  const model = typeof options.model === 'string' ? options.model : null
  if (provider === null || model === null) return null
  const prompt = [CONSOLIDATION_INSTRUCTION, '', '对话：', ...conversation].join('\n')
  let stream
  try {
    stream = await llm.stream({
      provider,
      model,
      purpose: 'dsh-baibao: memory consolidation',
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    })
  } catch {
    return null
  }
  let text = ''
  let stopped = false
  try {
    for await (const chunk of stream) {
      if (chunk?.type === 'block-end' && typeof chunk.block?.text === 'string') {
        text = chunk.block.text
      } else if (chunk?.type === 'finish') {
        // Model-layer failures arrive here, not as a thrown error.
        stopped = chunk.reason?.kind === 'stop'
      }
    }
  } catch {
    return null
  }
  if (!stopped) return null
  return parseConsolidationReply(text)
}

/**
 * LLM-backed consolidation, falling back to the heuristic extractor when the
 * model is unavailable so the explicit-memory loop keeps working.
 *
 * Returns the entries actually written, for logging and tests.
 */
export async function consolidateAgent(ctx, agent, workspacePath, options = {}) {
  if (!isBaibaoAgent(agent, workspacePath)) return []
  // Scan the recent messages rather than only the last one: a preference is
  // often stated across two messages ("别记这个" / "记住了，用简洁版").
  const messages = await readRecentUserMessages(ctx, agent)
  if (messages.length === 0) return []
  const stored = new Set((await listMemory()).map((entry) => normalizeMemoryText(entry.text)))
  const written = []

  const facts = await extractFactsWithLlm(ctx, messages, options)
  if (facts !== null) {
    for (const fact of facts) {
      const fingerprint = normalizeMemoryText(fact.text)
      if (stored.has(fingerprint)) continue
      const entry = await saveMemory({
        ...fact,
        source: 'agent-inferred',
        tags: [...fact.tags, 'llm'],
      })
      stored.add(fingerprint)
      written.push(entry)
    }
    return written
  }

  // Heuristic fallback: rule-based extraction over the same messages.
  for (const text of messages) {
    const candidate = extractMemoryCandidate(text)
    if (candidate === null) continue
    if (stored.has(normalizeMemoryText(candidate.text))) continue
    const entry = await saveMemory(candidate)
    stored.add(normalizeMemoryText(candidate.text))
    written.push(entry)
  }
  return written
}

/** Remember the last consolidated turn so a turn is not processed twice. */
export function markTurnConsolidated(agentId, turn) {
  const previous = lastConsolidatedTurns.get(agentId)
  if (previous === turn) return false
  lastConsolidatedTurns.set(agentId, turn)
  return true
}
