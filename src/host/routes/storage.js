/** Storage root and backup routes. */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { defaultRoot, pathExists, readLocation, writeLocation } from '../paths.js'
import {
  createBackup,
  createDefaults,
  deleteBackup,
  describe,
  isInside,
  listBackups,
  migrateStorage,
} from '../storage.js'
import { readJson, sendJson } from '../util.js'

export function registerStorageRoutes(ctx, hostCtx, hooks = {}) {
  const webServer = hostCtx.webServer

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/storage',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                const location = await readLocation()
                sendJson(response, 200, {
                  ok: true,
                  storage: await describe(location.root, location.configured),
                })
                return
              }

              if (request.method === 'POST') {
                const body = await readJson(request)
                const raw = body !== null && typeof body.root === 'string' ? body.root.trim() : ''
                if (raw === '' || !path.isAbsolute(raw)) {
                  sendJson(response, 400, { ok: false, error: 'invalid-path' })
                  return
                }
                const root = path.resolve(raw)
                if (path.parse(root).root === root) {
                  sendJson(response, 400, { ok: false, error: 'filesystem-root' })
                  return
                }
                const previous = await readLocation()
                if (
                  previous.root !== root &&
                  (isInside(previous.root, root) || isInside(root, previous.root))
                ) {
                  sendJson(response, 400, { ok: false, error: 'nested-path' })
                  return
                }
                let migration = null
                const shouldMigrate = body.migrate !== false
                if (
                  shouldMigrate &&
                  previous.root !== root &&
                  ((await pathExists(previous.root)) || previous.configured)
                ) {
                  migration = await migrateStorage(previous.root, root)
                } else {
                  await createDefaults(root)
                  await writeLocation(root)
                }
                hooks.onStorageChanged?.()
                sendJson(response, 200, {
                  ok: true,
                  storage: await describe(root, true),
                  migration,
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
      'dsh-baibao: storage route',
    )

    hostCtx.effect(
      () =>
        webServer.register({
          kind: 'exact',
          path: '/dsh-baibao/api/storage/backups',
          handler: async (request, response) => {
            try {
              if (request.method === 'GET') {
                sendJson(response, 200, { ok: true, backups: await listBackups() })
                return
              }

              if (request.method === 'POST') {
                const backup = await createBackup()
                sendJson(response, 200, {
                  ok: true,
                  backup,
                  backups: await listBackups(),
                })
                return
              }

              if (request.method === 'DELETE') {
                const url = new URL(request.url ?? '/', 'http://localhost')
                const id = url.searchParams.get('id')
                if (id === null || id === '') {
                  sendJson(response, 400, { ok: false, error: 'missing-backup-id' })
                  return
                }
                await deleteBackup(id)
                sendJson(response, 200, { ok: true, backups: await listBackups() })
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
      'dsh-baibao: storage backups route',
    )
}
