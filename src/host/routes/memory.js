/** Memory list, save and delete routes. */
import { deleteMemory, listMemory, saveMemory } from '../memory.js'
import { paginate, readJson, sendJson } from '../util.js'

export function registerMemoryRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/memory',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                const matched = await listMemory(url.searchParams.get('q') ?? '')
                const page = paginate(
                  matched,
                  Number(url.searchParams.get('page')),
                  Number(url.searchParams.get('pageSize')),
                )
                sendJson(response, 200, { ok: true, ...page })
                return
              }

              if (request.method === 'POST') {
                const body = await readJson(request)
                const entry = await saveMemory(body)
                sendJson(response, 200, { ok: true, entry })
                return
              }

              if (request.method === 'DELETE') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                const id = url.searchParams.get('id')
                if (id === null || id === '') {
                  sendJson(response, 400, { ok: false, error: 'missing-memory-id' })
                  return
                }
                sendJson(response, 200, { ok: true, deleted: await deleteMemory(id) })
                return
              }

              response.writeHead(405, { allow: 'GET, POST, DELETE' })
              response.end()
            } catch (error) {
              sendJson(response, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        }),
      'dsh-baibao: memory route',
    )
}

