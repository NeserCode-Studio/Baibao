/**
 * 百宝 — the browser half.
 *
 * M0 registers the two seats this plugin has today: a row in the root-scoped
 * `sidebar.panellist` list, and the console that same id addresses in the
 * layout's keyed `main` slot. The sidebar owns the row, its selected state and
 * its collapsed tooltip; this plugin owns the glyph and the page.
 *
 * The chat itself is not a second chat shell. It will open a native DSH
 * Session in the 百宝 workspace and add persona/memory chrome through the
 * `conversation.*` slots once M1 has verified that path.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only imports: they bring in the host packages' `declare module`
// augmentations (`Context.slots`, `Context.locale`, `sidebar.panellist`, `main`)
// and are erased before the bundle is built.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { BaibaoIcon } from './icon'
import { startBaibaoChat } from './chat-api'
import { en, zh } from './locales'
import panelCss from './panel.css'
import { BaibaoPanel, type TranslateBaibao } from './panel'

export const name = 'dsh-baibao'

/** Client services this plugin reads: slots, locale, and panel navigation. */
export const inject = ['slots', 'locale', 'layout']

/** Locale namespace and the panel id are the same string: one identity, one row. */
const NS = 'dsh-baibao'
const PANEL_ID = 'dsh-baibao' as MainPanelId

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-baibao: dictionaries')
  ctx.effect(() => installStyles(), 'dsh-baibao: styles')

  const t = ctx.locale.bind(NS)

  // `slots.inject` waits for the parent's declaration, so this plugin activates
  // correctly whether it loads before or after the sidebar shell.
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 1,
            label: () => t('nav'),
            locale: NS,
          },
          BaibaoIcon,
        ),
      ),
    'dsh-baibao: sidebar entry',
  )

  const pickDirectory = async (): Promise<string | null> => {
    const uiWorkspace = ctx.get('uiWorkspace') as
      | { pickDirectory?: () => Promise<string | null> }
      | undefined
    return uiWorkspace?.pickDirectory !== undefined
      ? await uiWorkspace.pickDirectory()
      : null
  }

  const openChat = async (): Promise<void> => {
    const result = await startBaibaoChat()
    if (result.ok !== true || typeof result.sessionId !== 'string') {
      throw new Error(result.error ?? 'start-failed')
    }
    const uiWorkspace = ctx.get('uiWorkspace') as
      | {
          openWorkspace?: (workspaceId: string) => Promise<void>
          openSession?: (target: string) => void
        }
      | undefined
    if (uiWorkspace?.openWorkspace !== undefined && result.workspace !== undefined) {
      await uiWorkspace.openWorkspace(result.workspace.id)
    } else {
      uiWorkspace?.openSession?.(result.sessionId)
    }
    ctx.layout.selectPanel('conversation' as MainPanelId)
  }

  const BaibaoPanelSeat = ({ t: translate }: { t: TranslateBaibao }) => (
    <BaibaoPanel
      t={translate}
      onPickDirectory={pickDirectory}
      onStartChat={openChat}
    />
  )

  ctx.effect(
    () =>
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
          },
          BaibaoPanelSeat,
        ),
      ),
    'dsh-baibao: main panel',
  )
}

/**
 * Own the panel's stylesheet as one plugin-owned `<style>` tag.
 * @returns disposer removing the tag.
 */
function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const tag = document.createElement('style')
  tag.dataset['plugin'] = NS
  tag.dataset['pluginCss'] = `${NS}/panel.css`
  tag.textContent = panelCss
  document.head.appendChild(tag)
  return () => tag.remove()
}
