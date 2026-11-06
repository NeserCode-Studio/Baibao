/**
 * Channel configuration API.
 *
 * Deliberately returns only masked channels: the panel needs to know whether a
 * secret exists, never what it is. Accepting an empty `appSecret` on write
 * means "keep the stored one", which is the only safe contract when the client
 * never receives the real value.
 */
import { maskChannel, readChannels, writeChannel } from '../channels/store.js'
import { readJson, sendJson } from '../util.js'

/** Live connector state, set by the channel manager. */
let statusProvider = () => ({ qq: { state: 'stopped' } })

export function setChannelStatusProvider(provider) {
  statusProvider = provider
}

export function registerChannelRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

  hostCtx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: '/dsh-baibao/api/channels',
        handler: async (request, response) => {
          try {
            if (request.method === 'GET') {
              const channels = await readChannels()
              sendJson(response, 200, {
                ok: true,
                channels: ['qq'].map((id) => maskChannel(id, channels[id])),
                status: statusProvider(),
              })
              return
            }

            if (request.method === 'POST') {
              const body = await readJson(request)
              const id = typeof body?.id === 'string' ? body.id : ''
              if (id === '') {
                sendJson(response, 400, { ok: false, error: 'missing-channel-id' })
                return
              }
              const updated = await writeChannel(id, body)
              const channels = await readChannels()
              sendJson(response, 200, {
                ok: true,
                channel: maskChannel(id, updated),
                channels: ['qq'].map((key) => maskChannel(key, channels[key])),
                status: statusProvider(),
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
    'dsh-baibao: channels route',
  )
}
