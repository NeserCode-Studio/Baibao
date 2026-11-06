/**
 * Channel configuration API.
 *
 * Deliberately returns only masked channels: the panel needs to know whether a
 * secret exists, never what it is. Accepting an empty `appSecret` on write
 * means "keep the stored one", which is the only safe contract when the client
 * never receives the real value.
 *
 * Saving also reconciles the live connection: enabling a fully configured
 * channel starts it, disabling one stops it. That way the panel has no separate
 * "connect" button that could drift out of sync with the stored settings.
 */
import {
  channelStatus,
  forgetSender,
  pendingSenders,
  startChannel,
  stopChannel,
} from '../channels/manager.js'
import { maskChannel, readChannels, writeChannel } from '../channels/store.js'
import { readJson, sendJson } from '../util.js'

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
                status: channelStatus(),
                pendingSenders: pendingSenders(),
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

              // "Approve this sender" is the common case and would otherwise
              // require the operator to copy an OpenID by hand.
              if (typeof body?.approveSender === 'string' && body.approveSender !== '') {
                const target = body.approveSender.trim()
                const existing = (await readChannels())[id]
                const users = existing.allowedUsers.includes(target)
                  ? existing.allowedUsers
                  : [...existing.allowedUsers, target]
                const updated = await writeChannel(id, { allowedUsers: users })
                forgetSender(target)
                const channels = await readChannels()
                sendJson(response, 200, {
                  ok: true,
                  channel: maskChannel(id, updated),
                  channels: ['qq'].map((key) => maskChannel(key, channels[key])),
                  status: channelStatus(),
                  pendingSenders: pendingSenders(),
                })
                return
              }

              const updated = await writeChannel(id, body)

              // Reconcile the connection with what was just saved. A failure
              // here is reported but must not fail the save itself: the
              // settings are persisted either way.
              let connectError = null
              if (updated.enabled && updated.appId !== '' && updated.appSecret !== '') {
                try {
                  await startChannel(id)
                } catch (error) {
                  connectError = error instanceof Error ? error.message : String(error)
                }
              } else {
                stopChannel(id)
              }

              const channels = await readChannels()
              sendJson(response, 200, {
                ok: true,
                channel: maskChannel(id, updated),
                channels: ['qq'].map((key) => maskChannel(key, channels[key])),
                status: channelStatus(),
                pendingSenders: pendingSenders(),
                ...(connectError === null ? {} : { connectError }),
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
