/**
 * Copy for the 百宝 console.
 *
 * Client UI text in DSH enters through typed namespace dictionaries: every
 * namespace merged into `LocaleNamespaceMap` must ship both built-in locales,
 * so `zh` and `en` here carry the same key set and the compiler enforces it.
 */
export const zh = {
  nav: '百宝',
  title: '百宝',
  subtitle: '住在 DSH 里的长期 Agent：记得你，保持自己的性格，也会在需要时主动开口。',
  stage: '方向重置 · 骨架阶段',
  tabChat: '对话',
  tabMemory: '记忆',
  tabConnections: '连接',
  tabSettings: '设置',
  chatTitle: '像对话一样开始',
  chatBody:
    '百宝的对话会复用 DSH 原生会话：流式回复、工具调用、审批、附件和模型选择都保持官方体验。',
  chatWorkspaceTitle: '独立 workspace',
  chatWorkspaceBody: '百宝的会话放在自己的目录里，不与项目会话混在一起。',
  chatThreadsTitle: '一个百宝，多个 thread',
  chatThreadsBody: '每个话题是一条可恢复的会话，人格与长期记忆共享。',
  chatNativeTitle: '原生体验',
  chatNativeBody: '不重写聊天壳；百宝只补上身份、记忆和安静的主动性。',
  chatAction: '打开对话（M1 后接入）',
  composerPlaceholder: '和百宝说点什么…',
  send: '发送',
  memoryTitle: '长期记忆',
  memoryBody:
    '记忆分三层：固定的 core memory、按时间叙述的 episode，以及可追溯的事实与偏好。',
  memoryCoreTitle: 'Core',
  memoryCoreBody: '用户画像、当前重点、活跃承诺；每轮固定注入，预算内裁剪。',
  memoryEpisodeTitle: 'Episode',
  memoryEpisodeBody: '按 thread 记录目标、结果和开放回路，支持跨会话回忆。',
  memorySemanticTitle: 'Semantic',
  memorySemanticBody: '带来源、置信度和有效期的事实；旧事实失效但不消失。',
  connectionsTitle: '主动，但保持安静',
  connectionsBody: '先由规则快筛，再由语义判断是否值得打扰；有具体结果才开口。',
  connectionsQuietTitle: '默认不打扰',
  connectionsQuietBody: '免打扰时段、每日预算、优先级；资讯类只进收件箱。',
  connectionsTriggerTitle: '可配置的触发器',
  connectionsTriggerBody: '时间、Webhook、DSH 事件；每条通知都可追溯、可反馈。',
  settingsTitle: '设置留在插件里',
  settingsBody: '人格、模型、记忆和推送都在百宝控制台内完成，不需要先翻 DSH 设置。',
  settingsLocalTitle: '本地优先',
  settingsLocalBody: '记忆和人格默认只保存在这台机器；可导出、可清空。',
  settingsMirrorTitle: '可镜像到设置中心',
  settingsMirrorBody: '适合表单的选项可以同步到 DSH 设置中心，但只有一份数据。',
  footer: 'M0 · 方向重置 · 当前只保留插件骨架，Agent 运行时尚未接入',
  localOnly: '数据默认只留在这台机器。',
  planned: '规划中',
} as const

/** Dictionary key union for the `dsh-baibao` namespace. */
export type BaibaoKey = keyof typeof zh

export const en: Record<BaibaoKey, string> = {
  nav: 'Baibao',
  title: 'Baibao',
  subtitle:
    'A long-lived agent inside DSH: remembers you, keeps its own character, and speaks up only when it matters.',
  stage: 'Direction reset · skeleton',
  tabChat: 'Chat',
  tabMemory: 'Memory',
  tabConnections: 'Connections',
  tabSettings: 'Settings',
  chatTitle: 'Start like a conversation',
  chatBody:
    'Baibao chats through the native DSH conversation, keeping streaming, tool calls, approvals, attachments, and model selection exactly as the official agent.',
  chatWorkspaceTitle: 'Its own workspace',
  chatWorkspaceBody: 'Baibao sessions live in a dedicated directory, apart from project sessions.',
  chatThreadsTitle: 'One Baibao, many threads',
  chatThreadsBody: 'Each topic is a resumable session; persona and long-term memory are shared.',
  chatNativeTitle: 'Native experience',
  chatNativeBody: 'No second chat shell. Baibao only adds identity, memory, and quiet initiative.',
  chatAction: 'Open chat (after M1)',
  composerPlaceholder: 'Say something to Baibao…',
  send: 'Send',
  memoryTitle: 'Long-term memory',
  memoryBody:
    'Three layers: pinned core memory, time-ordered episodes, and traceable facts and preferences.',
  memoryCoreTitle: 'Core',
  memoryCoreBody: 'Profile, current focus, active commitments; injected every turn within budget.',
  memoryEpisodeTitle: 'Episode',
  memoryEpisodeBody: 'Goals, outcomes, and open loops per thread, recalled across sessions.',
  memorySemanticTitle: 'Semantic',
  memorySemanticBody: 'Facts with provenance, confidence, and validity; old facts expire, not vanish.',
  connectionsTitle: 'Proactive, but quiet',
  connectionsBody:
    'Deterministic rules filter first, then a semantic gate decides whether now is worth interrupting; speak only with a concrete result.',
  connectionsQuietTitle: 'Quiet by default',
  connectionsQuietBody: 'Quiet hours, daily budget, priorities; informational items go to the inbox.',
  connectionsTriggerTitle: 'Configurable triggers',
  connectionsTriggerBody: 'Schedule, webhook, and DSH events; every notification is auditable and ratable.',
  settingsTitle: 'Settings stay in the plugin',
  settingsBody:
    'Persona, model, memory, and push are managed in the Baibao console, without digging through DSH settings first.',
  settingsLocalTitle: 'Local first',
  settingsLocalBody: 'Memory and persona stay on this machine by default; exportable and erasable.',
  settingsMirrorTitle: 'Mirrorable to Settings',
  settingsMirrorBody:
    'Form-friendly options can appear in DSH Settings, backed by the same single source of truth.',
  footer: 'M0 · direction reset · scaffold only; the agent runtime is not wired yet',
  localOnly: 'Data stays on this machine by default.',
  planned: 'Planned',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 百宝 console copy. */
    'dsh-baibao': BaibaoKey
  }
}
