/** Consolidation-model settings plus the models actually available. */
import { readConsolidationModel } from '../consolidate.js'
import { readConfigData, writeConfigData } from '../config.js'
import { readJson, sendJson } from '../util.js'

export function registerConfigRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

    // Consolidation model settings plus the models actually available, so the
    // panel can offer real choices instead of a free-text field.
    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/config',
          handler: async (request, response) => {
            try {
              const llm = ctx.get('llm')
              const available =
                llm !== undefined && typeof llm.listProviders === 'function'
                  ? await llm.listProviders()
                  : []
              const models = []
              for (const provider of available) {
                if (typeof llm.listModels !== 'function') break
                try {
                  const list = await llm.listModels(provider.id)
                  for (const model of list) {
                    models.push({
                      provider: provider.id,
                      providerName: provider.name ?? provider.id,
                      id: model.id,
                      name: model.name ?? model.id,
                    })
                  }
                } catch {
                  // A provider without a working adapter is simply not offered.
                }
              }
              if (request.method === 'GET') {
                const current = await readConsolidationModel()
                sendJson(response, 200, {
                  ok: true,
                  consolidation: current,
                  models,
                })
                return
              }
              if (request.method === 'POST') {
                const body = await readJson(request)
                const config = await readConfigData()
                const memory = { ...(config.memory ?? {}) }
                const provider = typeof body?.provider === 'string' ? body.provider.trim() : ''
                const model = typeof body?.model === 'string' ? body.model.trim() : ''
                if (provider === '' || model === '') {
                  delete memory.consolidationProvider
                  delete memory.consolidationModel
                } else {
                  memory.consolidationProvider = provider
                  memory.consolidationModel = model
                }
                config.memory = memory
                config.updatedAt = new Date().toISOString()
                await writeConfigData(config)
                sendJson(response, 200, {
                  ok: true,
                  consolidation: await readConsolidationModel(),
                  models,
                })
                return
              }
              response.writeHead(405, { allow: 'GET, POST' })
              response.end()
            } catch (error) {
              sendJson(response, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        }),
      'dsh-baibao: config route',
    )
}

