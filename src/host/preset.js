/**
 * The `baibao` agent preset: which plugins the Baibao agent runs with, and the
 * registration that installs it once per host start.
 *
 * Mirrors the `ptc` preset (the fullest built-in composition) with two
 * deliberate differences:
 *
 * - no `dsh-persona` row: Baibao supplies its own identity through the
 *   `baibao-persona` / `baibao-persona-tuning` sections, and a second prefix
 *   here would be a competing source of truth;
 * - the terminal uses `dsh-tool-pwsh`, the row `standard` ships, because the
 *   PTY stack (`dsh-terminal` + `dsh-terminal-bash`) cannot start a shell on
 *   this machine: pwsh exists only as a 0-byte Store alias that conpty cannot
 *   execute, and WSL's bash dies with `E_ACCESSDENIED` mounting its vhdx, so
 *   both legal `shellDialect` values exit immediately.
 *
 * Everything else follows `ptc`'s config verbatim; those values are tuned by
 * DSH itself and guessing replacements would only drift from it.
 */
/**
 * Plan-mode instructions, copied verbatim from the `ptc` preset document
 * (`agentPresets.readDocument('ptc')`). Plan mode's behaviour lives entirely in
 * this section, so paraphrasing it would silently change how the mode behaves.
 */
const PLAN_MODE_SECTION = `You are in plan mode. Stay in plan mode until the user approves your plan through exit_plan_mode or switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.`

export function baibaoPlugins() {
  return [
    {
      id: 'agent-instructions',
      name: '@deepseek-ai/dsh-agent-instructions',
      config: { maxBytes: 65536 },
    },
    { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
    { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
    {
      id: 'tool-fs',
      name: '@deepseek-ai/dsh-tool-fs',
      config: { read: true, readImage: true, write: true, edit: true, applyPatch: false },
    },
    {
      id: 'tool-fs-search',
      name: '@deepseek-ai/dsh-tool-fs-search',
      config: { sampleOverCapGlobResults: false },
    },
    { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
    { id: 'tool-schedule', name: '@deepseek-ai/dsh-tool-schedule' },
    { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
    { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
    { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
    { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
    {
      id: 'planning',
      name: 'cordis:group',
      group: true,
      isolate: { planMode: true },
      config: [
        {
          id: 'plan-mode',
          name: '@deepseek-ai/dsh-plan-mode',
          config: { section: PLAN_MODE_SECTION },
        },
      ],
    },
    {
      id: 'compaction',
      name: 'cordis:group',
      group: true,
      isolate: { compaction: true, toolResultPruner: true },
      config: [
        { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
        { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
        {
          id: 'tool-result-pruner',
          name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
          config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
        },
      ],
    },
    {
      id: 'delegation',
      name: 'cordis:group',
      group: true,
      isolate: { workflowEngine: true },
      config: [
        { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
        {
          id: 'tool-subagent',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: {
            provider: 'spawn',
            toolName: 'subagent',
            modelSelection: true,
            modelDiscovery: true,
          },
        },
        {
          id: 'tool-subagent-fork',
          name: '@deepseek-ai/dsh-tool-subagent',
          config: { provider: 'fork', toolName: 'subagent_fork' },
        },
        {
          id: 'workflow-ptc',
          name: '@deepseek-ai/dsh-workflow-ptc',
          config: { provider: 'spawn' },
        },
        { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
      ],
    },
    { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
    {
      id: 'tool-todo',
      name: '@deepseek-ai/dsh-tool-todo',
      config: { allowParallelInProgress: true },
    },
    {
      id: 'tool-web',
      name: '@deepseek-ai/dsh-tool-web',
      config: { fetch: true, searchTimeoutMs: 60000 },
    },
    { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
  ]
}

/**
 * Install the `baibao` preset if it is not there yet.
 *
 * Returns the outcome instead of throwing or logging: a failed registration is
 * indistinguishable from success from the outside (`register()` does not throw,
 * DSH validates afterwards), so the caller needs the detail to report it.
 */
export async function ensureBaibaoPreset(presets) {
  if (presets === undefined) {
    return { attempted: false, ok: false, error: 'service-missing' }
  }
  try {
    const list = await presets.list()
    const existing = list.find((preset) => preset.id === 'baibao')
    if (existing !== undefined) {
      return {
        attempted: false,
        ok: true,
        error: null,
        alreadyPresent: true,
        broken: existing.broken ?? null,
      }
    }
    await presets.register({
      id: 'baibao',
      name: '百宝',
      description: '百宝的默认 Agent 模式：长期助手人格、文件与终端工具。',
      order: 20,
      plugins: baibaoPlugins(),
    })
    return { attempted: true, ok: true, error: null }
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}