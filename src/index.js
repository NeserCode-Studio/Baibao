/**
 * Host (Node) half of dsh-baibao.
 *
 * This file is assembly only: it wires the modules together and registers the
 * HTTP routes. The behaviour lives in `./host/`:
 *
 *   paths       storage-root resolution and the location pointer
 *   storage     layout, migration between roots, backups
 *   config      the user-editable `config/baibao.json`
 *   persona     Jungian axes, presets, consistency audit, prompt fragments
 *   memory      the memory store, lexical search, `memory_*` tools
 *   consolidate turning a conversation into memory (LLM + heuristic fallback)
 *   push        the inbox store and the deterministic rule gate
 *   preset      the `baibao` agent preset and its registration
 *   routes/*    one module per API surface
 *
 * The data root defaults to `$DSH_HOME/baibao` and can be repointed; the
 * workspace stays under the default root so an unmapped drive cannot break it.
 */
import path from 'node:path'
import { attachBaibaoAgent } from './host/agent-hook.js'
import { askAgent } from './host/channels/agent-bridge.js'
import { configureChannels, startChannel } from './host/channels/manager.js'
import { readChannels } from './host/channels/store.js'
import { defaultRoot, readLocation } from './host/paths.js'
import { ensureBaibaoPreset } from './host/preset.js'
import { registerChatRoutes } from './host/routes/chat.js'
import { registerChannelRoutes } from './host/routes/channels.js'
import { registerConfigRoutes } from './host/routes/config.js'
import { registerMemoryRoutes } from './host/routes/memory.js'
import { registerNotificationRoutes } from './host/routes/notifications.js'
import { registerPersonaRoutes } from './host/routes/persona.js'
import { registerPushRoutes } from './host/routes/push.js'
import { registerStorageRoutes } from './host/routes/storage.js'

export const name = 'dsh-baibao'

export function apply(ctx) {
  const state = {
    /** Absolute path of the Baibao workspace, used to recognise its agents. */
    workspacePath: null,
    /** Resolves once preset registration has settled, or false on timeout. */
    presetsReady: null,
    /** Last registration outcome, reported by `chat/start`. */
    presetStatus: { attempted: false, ok: false, error: 'not-run' },
  }

  // The timer must not win against a late-but-successful registration,
  // otherwise `chat/start` keeps omitting the preset for the rest of the
  // session. Settle exactly once, whichever happens first.
  let settlePresets = null
  state.presetsReady = new Promise((resolve) => {
    settlePresets = resolve
  })
  let settled = false
  const presetTimer = setTimeout(() => settle(false), 3000)
  const settle = (value) => {
    if (settled) return
    settled = true
    clearTimeout(presetTimer)
    settlePresets?.(value)
  }

  ctx.inject(['agentPresets'], (presetCtx) => {
    void ensureBaibaoPreset(presetCtx.agentPresets)
      .then((status) => {
        state.presetStatus = status
        settle(status.ok === true)
      })
      .catch(() => settle(false))
  })

  void readLocation()
    .then(() => {
      state.workspacePath = path.join(defaultRoot(), 'workspace')
    })
    .catch(() => {})

  ctx.effect(
    () =>
      ctx.on('agent/created', (payload) => {
        attachBaibaoAgent(ctx, payload.agent, state.workspacePath)
      }),
    'dsh-baibao: agent wiring',
  )

  // Channel wiring: a message from the phone becomes a real Baibao turn, and
  // the reply goes back to the same conversation.
  configureChannels({
    log: (level, detail) => {
      console.error(`[baibao:channel] ${level} ${detail}`)
    },
    onRejected: (message) => {
      console.error(`[baibao:channel] rejected unknown sender ${message.openid}`)
    },
    onMessage: async (message, reply) => {
      const log = (level, detail) => console.error(`[baibao:channel] ${level} ${detail}`)

      // A turn with tools can take a minute. Say something before then, so the
      // user is not staring at a spinner wondering whether it was received.
      let acknowledged = false
      const ackTimer = setTimeout(() => {
        acknowledged = true
        void reply('收到，我查一下，稍等…').catch(() => {})
      }, 8000)

      let answer = ''
      try {
        answer = await askAgent(ctx, message.text, {
          channel: message.channel,
          userId: message.userId,
          log,
        })
      } finally {
        clearTimeout(ackTimer)
      }

      const text =
        answer === ''
          ? acknowledged
            ? '这条我没能及时答完，你可以在百宝里接着问。'
            : '这条我没能及时回答，你可以在百宝里继续问。'
          : answer
      await reply(text)
      return ''
    },
  })
  // Reconnect channels that were left enabled, so a DSH restart does not
  // silently take the phone client offline.
  void readChannels()
    .then(async (channels) => {
      const qq = channels.qq
      const wx = channels.wechat
      const jobs = []
      if (qq.enabled && qq.appId !== '' && qq.appSecret !== '') jobs.push('qq')
      // WeChat has no credential to refresh; an expired login is already
      // persisted as disabled, so anything still enabled is worth resuming.
      if (wx.enabled && wx.botToken !== '') jobs.push('wechat')
      for (const id of jobs) {
        await startChannel(id).catch((error) => {
          console.error(
            `[baibao:channel] autostart ${id} failed: ` +
              (error instanceof Error ? error.message : String(error)),
          )
        })
      }
    })
    .catch(() => {})

  ctx.inject(['webServer'], (hostCtx) => {
    const onStorageChanged = () => {
      state.workspacePath = path.join(defaultRoot(), 'workspace')
    }
    registerStorageRoutes(ctx, hostCtx, { onStorageChanged })
    registerMemoryRoutes(ctx, hostCtx)
    registerNotificationRoutes(ctx, hostCtx)
    registerPersonaRoutes(ctx, hostCtx)
    registerConfigRoutes(ctx, hostCtx)
    registerChannelRoutes(ctx, hostCtx)
    registerPushRoutes(ctx, hostCtx)
    registerChatRoutes(ctx, hostCtx, {
      presetsReady: state.presetsReady,
      setWorkspacePath: (value) => {
        state.workspacePath = value
      },
      presetStatus: () => state.presetStatus,
    })
  })
}
