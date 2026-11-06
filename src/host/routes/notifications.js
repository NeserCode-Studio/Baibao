/** Push inbox routes. */
import {
  deleteNotification,
  listNotifications,
  saveNotification,
  unreadCount,
  updateNotification,
} from '../push.js'
import { paginate, readJson, sendJson } from '../util.js'

export function registerNotificationRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/notifications',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                const status = url.searchParams.get('status') ?? ''
                const items = await listNotifications(status)
                const page = paginate(
                  items,
                  Number(url.searchParams.get('page')),
                  Number(url.searchParams.get('pageSize')),
                )
                sendJson(response, 200, { ok: true, ...page, unread: await unreadCount() })
                return
              }

              if (request.method === 'POST') {
                const body = await readJson(request)
                const entry = await saveNotification(body)
                sendJson(response, 200, { ok: true, entry, unread: await unreadCount() })
                return
              }

              if (request.method === 'PATCH') {
                const body = await readJson(request)
                const id = typeof body?.id === 'string' ? body.id : ''
                if (id === '') {
                  sendJson(response, 400, { ok: false, error: 'missing-notification-id' })
                  return
                }
                const entry = await updateNotification(id, {
                  status: body.status,
                  feedback: body.feedback,
                })
                if (entry === null) {
                  sendJson(response, 404, { ok: false, error: 'not-found' })
                  return
                }
                sendJson(response, 200, { ok: true, entry, unread: await unreadCount() })
                return
              }

              if (request.method === 'DELETE') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                const id = url.searchParams.get('id')
                if (id === null || id === '') {
                  sendJson(response, 400, { ok: false, error: 'missing-notification-id' })
                  return
                }
                sendJson(response, 200, {
                  ok: true,
                  deleted: await deleteNotification(id),
                  unread: await unreadCount(),
                })
                return
              }

              response.writeHead(405, { allow: 'GET, POST, PATCH, DELETE' })
              response.end()
            } catch (error) {
              sendJson(response, 500, {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              })
            }
          },
        }),
      'dsh-baibao: notifications route',
    )
}

