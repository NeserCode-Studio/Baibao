/**
 * Per-agent wiring for Baibao.
 *
 * Everything here registers on the agent's own scope, so it disappears when
 * the agent is disposed and never leaks into other agents.
 *
 * The persona text is injected from `config.persona.text` unconditionally. It
 * used to be injected only when the preset did not compose, which meant the
 * user's edits were silently ignored on the one path that always composes it.
 */
import {
  consolidateAgent,
  isBaibaoAgent,
  markTurnConsolidated,
  readConsolidationModel,
  readLatestUserMessage,
  refreshMemorySection,
  renderMemoryContext,
} from './consolidate.js'
import { listMemory, memoryTools } from './memory.js'
import {
  DEFAULT_JUNG,
  DEFAULT_PERSONA_TEXT,
  personaPrompt,
  readPersona,
  readPersonaText,
} from './persona.js'

/**
 * Attach persona, memory tools, memory context and turn hooks to one agent.
 *
 * Returns false when the agent is not a Baibao agent, so the caller can skip
 * quietly.
 */
export function attachBaibaoAgent(ctx, agent, workspacePath) {
  const agentCtx = agent?.ctx
  if (agentCtx === undefined || !isBaibaoAgent(agent, workspacePath)) return false

  void (async () => {
    const presets = ctx.get('agentPresets')
    // Composing the preset is still worth doing: it brings the tool rows. The
    // persona text below is injected separately.
    if (
      presets?.composedPreset?.(agentCtx) !== 'baibao' &&
      typeof presets?.select === 'function'
    ) {
      try {
        await presets.select(agent, 'baibao')
      } catch {
        // Closed sessions or a missing preset keep their current composition.
      }
    }

    try {
      agentCtx.systemPrompt.section({
        name: 'baibao-persona',
        order: 50,
        text: await readPersonaText().catch(() => DEFAULT_PERSONA_TEXT),
      })
    } catch {
      // A resumed agent may already own the section in this scope.
    }

    try {
      for (const tool of memoryTools()) {
        agentCtx.tools.register(tool)
      }
    } catch {
      // A resumed agent may already own these tools in this scope.
    }

    // Seed the first turn with recent memories, then re-retrieve per turn from
    // the user's actual message instead of a fixed recent list.
    const seed = await listMemory()
    if (seed.length > 0) {
      try {
        agentCtx.systemPrompt.section({
          name: 'baibao-memory-context',
          order: 60,
          text: renderMemoryContext(seed),
        })
      } catch {
        // A resumed agent may already own the section in this scope.
      }
    }

    const persona = await readPersona().catch(() => ({
      jung: { ...DEFAULT_JUNG },
      preset: null,
    }))
    try {
      agentCtx.systemPrompt.section({
        name: 'baibao-persona-tuning',
        order: 51,
        text: personaPrompt(persona),
      })
    } catch {
      // A resumed agent may already own the section in this scope.
    }

    // One effect, two per-turn jobs: refresh memory for the next turn from the
    // message just sent, then consolidate. Both are async and must not block
    // the turn that is already stopping.
    agentCtx.effect(
      () =>
        agentCtx.on('agent/turn-stopping', (payload) => {
          if (!markTurnConsolidated(agent.id, payload.turn)) return
          void (async () => {
            const latest = await readLatestUserMessage(ctx, agent)
            if (latest !== null) {
              await refreshMemorySection(agentCtx, latest).catch(() => {})
            }
            // Without a configured model the LLM path declines and the
            // heuristic extractor runs instead, so nothing is lost.
            const model = await readConsolidationModel().catch(() => ({
              provider: null,
              model: null,
            }))
            await consolidateAgent(ctx, agent, workspacePath, model).catch(() => {})
          })().catch(() => {})
        }),
      'dsh-baibao: turn memory',
    )
  })().catch(() => {})

  return true
}
