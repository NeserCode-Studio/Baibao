/** TEMPORARY (S7): shape probe for the schedule service. Read-only. */
import { sendJson } from '../util.js'

export function registerSpikeRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

    // TEMPORARY (S7): shape probe for the `schedule` service. Read-only unless
    // `POST ?mode=create`, which is used once to check delivery timing.
    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/spike/schedule',
          handler: async (request, response) => {
            const report = { ok: true }
            const schedule = ctx.get('schedule')
            if (schedule === undefined) {
              sendJson(response, 200, { ok: false, error: 'schedule-not-injected' })
              return
            }
            const proto = Object.getPrototypeOf(schedule)
            report.own = Object.keys(schedule)
            report.proto = proto === null ? [] : Object.getOwnPropertyNames(proto)
            report.types = {}
            for (const key of [...report.own, ...report.proto]) {
              const value = schedule[key]
              report.types[key] = typeof value
              if (typeof value === 'function') {
                report.types[`${key}.length`] = value.length
              }
            }
            if (typeof schedule.list === 'function') {
              try {
                report.current = JSON.parse(JSON.stringify(await schedule.list()))
              } catch (error) {
                report.listError = error instanceof Error ? error.message : String(error)
              }
            }
            for (const method of ['catalog', 'deliveryLimits']) {
              if (typeof schedule[method] !== 'function') continue
              try {
                report[method] = JSON.parse(JSON.stringify(await schedule[method]()))
              } catch (error) {
                report[`${method}Error`] = error instanceof Error ? error.message : String(error)
              }
            }
            sendJson(response, 200, report)
          },
        }),
      'dsh-baibao: s7 schedule probe',
    )
}

