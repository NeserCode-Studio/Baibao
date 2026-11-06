/**
 * Create a Baibao session and report which preset it actually got.
 *
 * The preset is chosen in three steps (cwd, then workspaceId, then bare) because
 * a failed create is recoverable — but the reply always states the resolved
 * preset so a silent fall back to `standard` is visible instead of mysterious.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { defaultRoot } from '../paths.js'
import { sendJson } from '../util.js'

/**
 * @param hooks.presetsReady  promise resolving to whether the preset registered
 * @param hooks.setWorkspacePath  records the resolved workspace path
 * @param hooks.presetStatus  returns the last registration outcome
 */
export function registerChatRoutes(ctx, hostCtx, hooks) {
  const webServer = hostCtx.webServer

  hostCtx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: '/dsh-baibao/api/chat/start',
        handler: async (request, response) => {
          if (request.method !== 'POST') {
            response.writeHead(405, { allow: 'POST' })
            response.end()
            return
          }
          const registry = ctx.get('workspaceRegistry')
          const controller = ctx.get('sessionController')
          if (registry === undefined || controller === undefined) {
            sendJson(response, 503, { ok: false, error: 'workspace-unavailable' })
            return
          }
          try {
            const workspaceDir = path.join(defaultRoot(), 'workspace')
            await mkdir(workspaceDir, { recursive: true })
            const workspace = await registry.create(workspaceDir, '百宝')
            hooks.setWorkspacePath(workspace.path)
            const presetReady = await hooks.presetsReady
            const preset = presetReady ? 'baibao' : undefined
            let created
            try {
              created = await controller.create({
                cwd: workspace.path,
                ...(preset === undefined ? {} : { agentPreset: preset }),
              })
            } catch {
              try {
                created = await controller.create({
                  workspaceId: workspace.id,
                  ...(preset === undefined ? {} : { agentPreset: preset }),
                })
              } catch {
                created = await controller.create({ cwd: workspace.path })
              }
            }
            sendJson(response, 200, {
              ok: true,
              sessionId: created.sessionId,
              agentPreset: created.agentPreset ?? preset ?? null,
              // Surfaced so a preset that failed to register, or that DSH marked
              // broken, is visible here instead of silently resolving to
              // the standard preset.
              presetStatus: hooks.presetStatus(),
              workspace: {
                id: workspace.id,
                path: workspace.path,
                title: workspace.title,
              },
            })
          } catch (error) {
            sendJson(response, 500, {
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        },
      }),
    'dsh-baibao: chat start route',
  )
}
