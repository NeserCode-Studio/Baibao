/** Small helpers shared by every route handler. */

export const PAGE_SIZE_DEFAULT = 10
export const PAGE_SIZE_MAX = 100

/** Read a JSON request body, refusing anything above 64 KiB. */
export async function readJson(request) {
  let size = 0
  const chunks = []
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/**
 * Slice an already-ordered list into one page.
 *
 * `page` is clamped to 1 and `pageSize` to [1, 100]; a page past the end comes
 * back empty while `total` still reports the real count, so the caller can
 * correct itself instead of showing a blank list with no explanation.
 */
export function paginate(entries, page, pageSize) {
  const size = Math.max(
    1,
    Math.min(
      PAGE_SIZE_MAX,
      Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : PAGE_SIZE_DEFAULT,
    ),
  )
  const requested = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  const total = entries.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(requested, pageCount)
  const start = (current - 1) * size
  return {
    entries: entries.slice(start, start + size),
    total,
    page: current,
    pageSize: size,
    pageCount,
  }
}
