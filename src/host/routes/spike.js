/** TEMPORARY probes. Read-only except where noted. */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { defaultRoot } from '../paths.js'
import { readJson, sendJson } from '../util.js'

/**
 * TEMPORARY (channels): verify the session prompt/follow contract.
 *
 * Signatures taken from the open-source package
 * `deepseek-ai/deepseek-harness`, `packages/api/session-controller`:
 *
 *   prompt({ requestId, sessionId, mode, content }, signal)
 *   follow({ address: { kind: 'session', sessionId }, assistantStream }, signal)
 *     -> AsyncIterable<SessionFollowFrame>
 */
export function registerSpikeRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

  hostCtx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: '/dsh-baibao/api/spike/deliver',
        handler: async (request, response) => {
          const report = { ok: true, steps: [], frames: [] }
          const safe = (value) => {
            try {
              return JSON.parse(
                JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v)),
              )
            } catch {
              return String(value)
            }
          }
          const step = (name, result) => report.steps.push({ name, ...safe(result) })
          try {
            const body = await readJson(request)
            const text = typeof body?.text === 'string' ? body.text : '你好'

            const registry = ctx.get('workspaceRegistry')
            const controller = ctx.get('sessionController')
            if (registry === undefined || controller === undefined) {
              sendJson(response, 200, { ok: false, error: 'services-missing' })
              return
            }

            const workspaceDir = path.join(defaultRoot(), 'workspace')
            await mkdir(workspaceDir, { recursive: true })
            const workspace = await registry.create(workspaceDir, '百宝')
            const created = await controller.create({ cwd: workspace.path, agentPreset: 'baibao' })
            const sessionId = created.sessionId
            step('create', { sessionId, agentPreset: created.agentPreset })

            // Subscribe first so no assistant frame is missed.
            const streamAbort = new AbortController()
            const iterator = controller.follow(
              { address: { kind: 'session', sessionId }, assistantStream: true },
              streamAbort.signal,
            )[Symbol.asyncIterator]()

            const collected = []
            const pump = (async () => {
              for (let index = 0; index < 60; index += 1) {
                const next = await iterator.next()
                if (next.done === true) break
                const frame = safe(next.value)
                collected.push(frame)
                if (frame?.type === 'assistant-stream' || frame?.type === 'event') {
                  report.frames.push(frame)
                }
              }
            })().catch((error) => {
              step('pump-error', { message: error instanceof Error ? error.message : String(error) })
            })

            // Give the subscription a moment to deliver its snapshot.
            await new Promise((resolve) => setTimeout(resolve, 500))
            step('subscribed', { framesSoFar: collected.length })

            // Prompt with the complete request shape.
            let prompted = false
            try {
              const value = await controller.prompt(
                {
                  requestId: randomUUID(),
                  sessionId,
                  mode: 'queue',
                  content: [{ type: 'text', text }],
                },
                AbortSignal.timeout(60_000),
              )
              step('prompt', { ok: true, value })
              prompted = true
            } catch (error) {
              step('prompt', {
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              })
            }
            report.prompted = prompted

            // Let the turn run, then summarise what arrived.
            await new Promise((resolve) => setTimeout(resolve, 20_000))
            streamAbort.abort()
            await pump.catch(() => {})

            report.frameCount = collected.length
            report.frameTypes = collected.map((frame) => frame?.type ?? '?')
            const assistant = collected.filter(
              (frame) =>
                frame?.type === 'event' &&
                String(frame?.event?.type ?? '').includes('assistant'),
            )
            report.assistantEvents = assistant.slice(-5)
          } catch (error) {
            report.ok = false
            report.error = error instanceof Error ? error.message : String(error)
          }
          sendJson(response, 200, report)
        },
      }),
    'dsh-baibao: deliver probe',
  )

  // TEMPORARY (channels): how do we deliver a prompt into a Baibao session and
  // read the assistant's reply? Both are needed before the QQ channel can be
  // wired to the agent, and neither is documented where I can read it.
  hostCtx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: '/dsh-baibao/api/spike/session',
        handler: async (request, response) => {
          const report = { ok: true }
          const safe = (value) => {
            try {
              return JSON.parse(
                JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v)),
              )
            } catch {
              return String(value)
            }
          }
          for (const serviceName of ['sessionController', 'sessionQuery', 'agents', 'sessions']) {
            const service = ctx.get(serviceName)
            if (service === undefined) {
              report[serviceName] = 'missing'
              continue
            }
            const proto = Object.getPrototypeOf(service)
            const keys = [...new Set([...Object.keys(service), ...(proto === null ? [] : Object.getOwnPropertyNames(proto))])]
            report[serviceName] = {}
            for (const key of keys) {
              const value = service[key]
              if (typeof value !== 'function') continue
              report[serviceName][key] = { arity: value.length }
            }
          }
          sendJson(response, 200, report)
        },
      }),
    'dsh-baibao: session probe',
  )

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
