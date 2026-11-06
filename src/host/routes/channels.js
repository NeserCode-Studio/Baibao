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
import {
  CHANNEL_IDS,
  maskChannel,
  maskIdentity,
  readChannels,
  readIdentity,
  writeChannel,
  writeIdentity,
} from '../channels/store.js'
import { BUILD } from '../build.js'
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
                build: BUILD,
                channels: CHANNEL_IDS.map((id) => maskChannel(id, channels[id])),
                status: channelStatus(),
                pendingSenders: pendingSenders(),
                identity: maskIdentity(await readIdentity()),
              })
              return
            }

            if (request.method === 'POST') {
              const body = await readJson(request)
              if (body?.identity !== undefined && typeof body.identity === 'object') {
                await writeIdentity(body.identity)
                const all = await readChannels()
                sendJson(response, 200, {
                  ok: true,
                  channels: CHANNEL_IDS.map((key) => maskChannel(key, all[key])),
                  status: channelStatus(),
                  pendingSenders: pendingSenders(),
                  identity: maskIdentity(await readIdentity()),
                })
                return
              }
              const id = typeof body?.id === 'string' ? body.id : ''
              if (id === '') {
                sendJson(response, 400, { ok: false, error: 'missing-channel-id' })
                return
              }

              // WeChat logs in by QR scan; the panel drives the two steps.
              if (typeof body?.action === 'string') {
                const { pollQrStatus, requestQrCode } = await import('../channels/wechat.js')
                if (body.action === 'qr') {
                  try {
                    const code = await requestQrCode()
                    // The platform hands back a page URL, not an image; encode it
                    // here so the panel can show something scannable.
                    let image = ''
                    if (code.url !== '') {
                      try {
                        const qrcode = await import('qrcode')
                        image = await qrcode.default.toDataURL(code.url, {
                          margin: 1,
                          width: 320,
                          errorCorrectionLevel: 'M',
                        })
                      } catch {
                        // Without an encoder the URL is still shown as a link.
                        image = ''
                      }
                    }
                    sendJson(response, 200, { ok: true, qr: { qrcode: code.qrcode, image, url: code.url } })
                  } catch (error) {
                    sendJson(response, 200, {
                      ok: false,
                      error: error instanceof Error ? error.message : String(error),
                    })
                  }
                  return
                }
                if (body.action === 'poll') {
                  const qrcode = typeof body.qrcode === 'string' ? body.qrcode : ''
                  if (qrcode === '') {
                    sendJson(response, 400, { ok: false, error: 'missing-qrcode' })
                    return
                  }
                  try {
                    const state = await pollQrStatus(qrcode)
                    if (state.done) {
                      // Persist the credential and bring the channel up in one
                      // step: a successful scan should not need a second click.
                      const saved = await writeChannel('wechat', {
                        enabled: true,
                        botToken: state.botToken,
                        botId: state.botId,
                        userId: state.userId,
                      })
                      await startChannel('wechat').catch(() => {})
                      const all = await readChannels()
                      sendJson(response, 200, {
                        ok: true,
                        state,
                        channel: maskChannel('wechat', saved),
                        channels: ['qq', 'wechat'].map((key) => maskChannel(key, all[key])),
                        status: channelStatus(),
                        pendingSenders: pendingSenders(),
                      })
                      return
                    }
                    sendJson(response, 200, { ok: true, state })
                  } catch (error) {
                    sendJson(response, 200, {
                      ok: false,
                      error: error instanceof Error ? error.message : String(error),
                    })
                  }
                  return
                }
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
                  channels: CHANNEL_IDS.map((key) => maskChannel(key, channels[key])),
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
                channels: CHANNEL_IDS.map((key) => maskChannel(key, channels[key])),
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
