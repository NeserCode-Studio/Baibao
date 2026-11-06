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
import { readLog, listSessionLogs, describeSessionStore } from '../channels/session-files.js'
import { readJson, sendJson } from '../util.js'

export function registerChannelRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

  // TEMPORARY diagnostic: what tools do the live agents actually hold?
  // The host code is provably current (the build string below), while the tools
  // answering "no other conversations" are not, so the gap is tool registration
  // on already-created agents. This reports the truth instead of inferring it.
  hostCtx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: '/dsh-baibao/api/debug/agents',
        handler: async (request, response) => {
          const report = { build: BUILD, agents: [] }
          try {
            // Force the next turn onto a fresh session, and therefore a fresh
            // agent holding the current tool definitions.
            if (request.url !== undefined && request.url.includes('recycle=1')) {
              const workspaces = ctx.get('workspaceController')
              const { listSessionLogs } = await import('../channels/session-files.js')
              const stale = listSessionLogs(80).filter(
                (row) => row.title.startsWith('QQ ·') || row.title.startsWith('微信 ·'),
              )
              report.archived = []
              for (const row of stale) {
                try {
                  await workspaces.archiveSession({ sessionId: row.id })
                  report.archived.push(row.id.slice(8, 16))
                } catch (caught) {
                  report.archived.push(`${row.id.slice(8, 16)}:${caught instanceof Error ? caught.message : 'fail'}`)
                }
              }
            }
          } catch (caught) {
            report.recycleError = caught instanceof Error ? caught.message : String(caught)
          }
          try {
            // List first: reading a log records why it failed, and the store line
            // reports that reason. Calling describe first hid it.
            const rows = listSessionLogs(3)
            report.storeTitles = rows.map((row) => `${row.id.slice(8, 16)} [${row.title}]`)
            report.store = describeSessionStore()
            report.logProbe = rows.map((row) => {
              const records = readLog(row.file)
              return {
                id: row.id.slice(8, 16),
                records: records.length,
                types: records.slice(0, 10).map((item) => String(item?.type ?? '?')),
              }
            })
          } catch (caught) {
            report.storeError = caught instanceof Error ? caught.message : String(caught)
          }
          try {
            const agents = ctx.get('agents')
            const list = typeof agents?.list === 'function' ? agents.list() : []
            for (const agent of Array.isArray(list) ? list.slice(0, 20) : []) {
              let detail = null
              let error = null
              try {
                const tools = agent?.ctx?.tools
                if (tools !== undefined && tools !== null) {
                  let names = null
                  let sample = null
                  for (const method of ['definitions', 'schemas', 'view']) {
                    if (typeof tools[method] !== 'function') continue
                    try {
                      const value = await tools[method]()
                      const list = Array.isArray(value) ? value : []
                      names = list
                        .map((item) => item?.name ?? item?.function?.name ?? null)
                        .filter((item) => typeof item === 'string')
                      if (names.length > 0) {
                        // Capture one baibao tool's description to reveal its build.
                        const target = list.find(
                          (item) => (item?.name ?? item?.function?.name) === 'session_list',
                        )
                        if (target !== undefined) {
                          sample = JSON.stringify(target).slice(0, 400)
                        }
                        detail = { source: method, names, sample }
                        break
                      }
                    } catch (caught) {
                      detail = {
                        source: method,
                        failed: caught instanceof Error ? caught.message : String(caught),
                      }
                    }
                  }
                  if (detail === null) detail = { source: null, names }
                }
              } catch (caught) {
                error = caught instanceof Error ? caught.message : String(caught)
              }
              report.agents.push({
                id: String(agent?.id ?? ''),
                phase: agent?.phase?.kind ?? null,
                detail,
                error,
              })
            }
          } catch (caught) {
            report.error = caught instanceof Error ? caught.message : String(caught)
          }
          sendJson(response, 200, report)
        },
      }),
    'dsh-baibao: agent tool diagnostic',
  )

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
