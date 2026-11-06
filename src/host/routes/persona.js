/** Persona read/write route: axes, preset, base prompt and the audit notes. */
import {
  DEFAULT_PERSONA_TEXT,
  PERSONA_PRESETS,
  PERSONA_TEXT_LIMIT,
  personaAudit,
  readPersona,
  readPersonaText,
  writePersona,
  writePersonaText,
} from '../persona.js'
import { readJson, sendJson } from '../util.js'

export function registerPersonaRoutes(ctx, hostCtx) {
  const webServer = hostCtx.webServer

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/persona',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const [persona, text] = await Promise.all([
                  readPersona(),
                  readPersonaText(),
                ])
                sendJson(response, 200, {
                  ok: true,
                  persona,
                  text,
                  defaultText: DEFAULT_PERSONA_TEXT,
                  limit: PERSONA_TEXT_LIMIT,
                  presets: PERSONA_PRESETS,
                  audit: personaAudit(persona),
                })
                return
              }

              if (request.method === 'POST') {
                const body = await readJson(request)
                const persona = await writePersona(body)
                const text = body?.text === undefined ? await readPersonaText() : await writePersonaText(body)
                sendJson(response, 200, {
                  ok: true,
                  persona,
                  text,
                  defaultText: DEFAULT_PERSONA_TEXT,
                  limit: PERSONA_TEXT_LIMIT,
                  presets: PERSONA_PRESETS,
                  audit: personaAudit(persona),
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
      'dsh-baibao: persona route',
    )
}

