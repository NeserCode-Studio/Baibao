/**
 * Long-poll driver for the WeChat iLink channel.
 *
 * The server holds each `getupdates` request for up to 35 seconds, so this is a
 * simple sequential loop rather than a timer — there is nothing to throttle.
 *
 * Expiry is terminal, not retryable: `errcode -14` means the login is gone and
 * only a new QR scan can restore it. Retrying would spin forever against a dead
 * session, which is the failure the official plugin is criticised for (openclaw
 * issues #91933, #90949), so the runner stops and reports it instead.
 */
import { getUpdates, isSessionExpired, parseInbound, parseUpdates, sendText } from './wechat.js'

export class WeChatRunner {
  /**
   * @param options.token     bot token from the QR login
   * @param options.isAllowed (userId) => Promise<boolean>
   * @param options.onMessage async ({userId, text, contextToken}) => string reply
   * @param options.onRejected (inbound) => void, for unknown senders
   * @param options.onStatus  ({state, detail}) => void
   * @param options.log       (level, detail) => void
   */
  constructor(options) {
    this.token = options.token
    this.isAllowed = options.isAllowed ?? (async () => false)
    this.onMessage = options.onMessage ?? (async () => '')
    this.onRejected = options.onRejected ?? (() => {})
    this.onStatus = options.onStatus ?? (() => {})
    this.log = options.log ?? (() => {})

    this.cursor = ''
    this.running = false
    this.abort = null
    this.transportRetry = 1000
  }

  #status(state, detail) {
    try {
      this.onStatus({ state, ...(detail === undefined ? {} : { detail }) })
    } catch {
      // Status reporting must never break the loop.
    }
  }

  start() {
    if (this.running) return
    this.running = true
    void this.#loop()
  }

  stop() {
    this.running = false
    // Break the in-flight long poll so stop() is effective immediately.
    if (this.abort !== null) this.abort.abort()
    this.abort = null
    this.#status('stopped')
  }

  async #loop() {
    this.#status('connecting')
    while (this.running) {
      this.abort = new AbortController()
      try {
        const result = await getUpdates(this.token, this.cursor, this.abort.signal)
        this.transportRetry = 1000

        if (isSessionExpired(result.body)) {
          this.running = false
          this.#status('expired', 'login expired, scan again')
          return
        }
        if (!result.ok) {
          // A bad HTTP status is a transport problem, not a protocol answer.
          throw new Error(`updates-http-${result.status}`)
        }

        const { messages, cursor } = parseUpdates(result.body)
        if (cursor !== '') this.cursor = cursor
        this.#status('ready')

        for (const message of messages) {
          if (!this.running) break
          await this.#handle(message)
        }
      } catch (error) {
        if (!this.running) break
        // An aborted poll is a deliberate stop, not a failure.
        if (error instanceof Error && error.name === 'AbortError') break
        this.log('error', error instanceof Error ? error.message : String(error))
        this.#status('reconnecting', error instanceof Error ? error.message : undefined)
        await new Promise((resolve) => setTimeout(resolve, this.transportRetry))
        // Long polls are cheap; back off gently and cap it.
        this.transportRetry = Math.min(this.transportRetry * 2, 30_000)
      } finally {
        this.abort = null
      }
    }
  }

  async #handle(message) {
    const inbound = parseInbound(message)
    if (inbound === null) return

    if (!(await this.isAllowed(inbound.userId))) {
      try {
        this.onRejected(inbound)
      } catch {
        // Reporting must not break the loop.
      }
      return
    }
    if (inbound.contextToken === '') {
      // Without a context token the platform has nowhere to put a reply.
      this.log('error', `no context token from ${inbound.userId}`)
      return
    }

    let reply = ''
    try {
      reply = await this.onMessage(inbound)
    } catch (error) {
      this.log('error', `agent: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (typeof reply !== 'string' || reply.trim() === '') return

    try {
      const sent = await sendText(this.token, inbound.userId, reply, inbound.contextToken)
      if (!sent.ok || (sent.body?.ret !== undefined && Number(sent.body.ret) !== 0)) {
        this.log('error', `send failed: ${sent.status} ${JSON.stringify(sent.body).slice(0, 200)}`)
      }
    } catch (error) {
      this.log('error', `send: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
