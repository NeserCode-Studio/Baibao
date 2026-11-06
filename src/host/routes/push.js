/**
 * Push settings: quiet hours, the daily budget, and the master switch.
 *
 * These lived only in `config.push` until now, which meant the documented
 * defaults were also the only possible values — the rules existed but nobody
 * could change them.
 */
import { PUSH_DEFAULTS, notifiedTodayCount, readPushSettings } from '../push.js'
import { readJson, sendJson } from '../util.js'
import { readConfigData, writeConfigData } from '../config.js'

/** Clamp a clock to HH:MM; anything unparseable falls back to the default. */
function cleanClock(value, fallback) {
  if (typeof value !== 'string') return fallback
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return fallback
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function cleanSettings(current, patch) {
  const defaults = PUSH_DEFAULTS
  const next = { ...current }

  if (typeof patch?.enabled === 'boolean') next.enabled = patch.enabled
  if (typeof patch?.focusMode === 'boolean') next.focusMode = patch.focusMode

  if (patch?.dailyBudget !== undefined) {
    const value = Number(patch.dailyBudget)
    // Zero is meaningful (never interrupt), so only reject nonsense.
    next.dailyBudget = Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), 50) : current.dailyBudget
  }

  if (patch?.quietHours !== undefined && typeof patch.quietHours === 'object') {
    next.quietHours = {
      start: cleanClock(patch.quietHours.start, current.quietHours?.start ?? defaults.quietHours.start),
      end: cleanClock(patch.quietHours.end, current.quietHours?.end ?? defaults.quietHours.end),
    }
  }

  return next
}

export function registerPushRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

  hostCtx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: '/dsh-baibao/api/push',
        handler: async (request, response) => {
          try {
            if (request.method === 'GET') {
              sendJson(response, 200, {
                ok: true,
                settings: await readPushSettings(),
                // Shown next to the budget so the number means something.
                notifiedToday: await notifiedTodayCount(new Date()),
                defaults: PUSH_DEFAULTS,
              })
              return
            }

            if (request.method === 'POST') {
              const body = await readJson(request)
              const config = await readConfigData()
              const current = { ...PUSH_DEFAULTS, ...(config.push ?? {}) }
              config.push = cleanSettings(current, body)
              config.updatedAt = new Date().toISOString()
              await writeConfigData(config)
              sendJson(response, 200, {
                ok: true,
                settings: await readPushSettings(),
                notifiedToday: await notifiedTodayCount(new Date()),
                defaults: PUSH_DEFAULTS,
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
    'dsh-baibao: push route',
  )
}
