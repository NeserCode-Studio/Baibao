import { useState, type KeyboardEvent } from 'react'
import { BaibaoIcon } from './icon'
import type { BaibaoKey } from './locales'

/** The framework's translate seat for the `dsh-baibao` namespace. */
export type TranslateBaibao = (key: BaibaoKey, params?: Record<string, unknown>) => string

export interface BaibaoPanelProps {
  /** Injected by the slot renderer because the registration declares `locale`. */
  t: TranslateBaibao
}

type SectionProps = BaibaoPanelProps & { hidden: boolean }

const TABS = [
  { id: 'chat', label: 'tabChat' },
  { id: 'memory', label: 'tabMemory' },
  { id: 'connections', label: 'tabConnections' },
  { id: 'settings', label: 'tabSettings' },
] as const satisfies readonly { id: string; label: BaibaoKey }[]

type Tab = (typeof TABS)[number]['id']

/**
 * The 百宝 console behind the sidebar row.
 *
 * M0 keeps this panel honest: it shows the product shape (chat, memory,
 * connections, settings) without pretending the agent runtime exists. Each tab
 * is replaced by a real surface in the milestones listed in `.agent/plan.md`.
 */
export function BaibaoPanel({ t }: BaibaoPanelProps) {
  const [tab, setTab] = useState<Tab>('chat')

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: Tab): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = TABS.findIndex((item) => item.id === current)
    const next = TABS[(index + delta + TABS.length) % TABS.length]
    if (next === undefined) return
    setTab(next.id)
    document.getElementById(`bb-tab-${next.id}`)?.focus()
  }

  return (
    <div className="bb-root">
      <div className="bb-shell">
        <header className="bb-head">
          <span className="bb-mark">
            <BaibaoIcon size={30} />
          </span>
          <div className="bb-headText">
            <div className="bb-nameRow">
              <h1 className="bb-title">{t('title')}</h1>
              <span className="bb-stage">{t('stage')}</span>
            </div>
            <p className="bb-sub">{t('subtitle')}</p>
          </div>
        </header>

        <div className="bb-tabs" role="tablist" aria-label={t('title')}>
          {TABS.map((item) => {
            const active = item.id === tab
            return (
              <button
                key={item.id}
                id={`bb-tab-${item.id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`bb-panel-${item.id}`}
                tabIndex={active ? 0 : -1}
                className={active ? 'bb-tab bb-tabActive' : 'bb-tab'}
                onClick={() => setTab(item.id)}
                onKeyDown={(event) => onTabKeyDown(event, item.id)}
              >
                {t(item.label)}
              </button>
            )
          })}
        </div>

        <main className="bb-body">
          <ChatSection t={t} hidden={tab !== 'chat'} />
          <MemorySection t={t} hidden={tab !== 'memory'} />
          <ConnectionsSection t={t} hidden={tab !== 'connections'} />
          <SettingsSection t={t} hidden={tab !== 'settings'} />
        </main>

        <footer className="bb-foot">
          <span>{t('footer')}</span>
          <span className="bb-local">{t('localOnly')}</span>
        </footer>
      </div>
    </div>
  )
}

function ChatSection({ t, hidden }: SectionProps) {
  return (
    <section
      id="bb-panel-chat"
      role="tabpanel"
      aria-labelledby="bb-tab-chat"
      className="bb-section"
      hidden={hidden}
    >
      <SectionHead title={t('chatTitle')} body={t('chatBody')} />
      <div className="bb-grid">
        <Card title={t('chatWorkspaceTitle')} body={t('chatWorkspaceBody')} badge={t('planned')} />
        <Card title={t('chatThreadsTitle')} body={t('chatThreadsBody')} badge={t('planned')} />
        <Card title={t('chatNativeTitle')} body={t('chatNativeBody')} badge={t('planned')} />
      </div>
      <div className="bb-composer">
        <input
          className="bb-composerInput"
          type="text"
          placeholder={t('composerPlaceholder')}
          aria-label={t('composerPlaceholder')}
          disabled
        />
        <button type="button" className="bb-composerSend" disabled>
          {t('send')}
        </button>
      </div>
      <button type="button" className="bb-action" disabled>
        {t('chatAction')}
      </button>
    </section>
  )
}

function MemorySection({ t, hidden }: SectionProps) {
  return (
    <section
      id="bb-panel-memory"
      role="tabpanel"
      aria-labelledby="bb-tab-memory"
      className="bb-section"
      hidden={hidden}
    >
      <SectionHead title={t('memoryTitle')} body={t('memoryBody')} />
      <div className="bb-grid">
        <Card title={t('memoryCoreTitle')} body={t('memoryCoreBody')} badge={t('planned')} />
        <Card title={t('memoryEpisodeTitle')} body={t('memoryEpisodeBody')} badge={t('planned')} />
        <Card title={t('memorySemanticTitle')} body={t('memorySemanticBody')} badge={t('planned')} />
      </div>
    </section>
  )
}

function ConnectionsSection({ t, hidden }: SectionProps) {
  return (
    <section
      id="bb-panel-connections"
      role="tabpanel"
      aria-labelledby="bb-tab-connections"
      className="bb-section"
      hidden={hidden}
    >
      <SectionHead title={t('connectionsTitle')} body={t('connectionsBody')} />
      <div className="bb-grid bb-gridTwo">
        <Card title={t('connectionsQuietTitle')} body={t('connectionsQuietBody')} badge={t('planned')} />
        <Card title={t('connectionsTriggerTitle')} body={t('connectionsTriggerBody')} badge={t('planned')} />
      </div>
    </section>
  )
}

function SettingsSection({ t, hidden }: SectionProps) {
  return (
    <section
      id="bb-panel-settings"
      role="tabpanel"
      aria-labelledby="bb-tab-settings"
      className="bb-section"
      hidden={hidden}
    >
      <SectionHead title={t('settingsTitle')} body={t('settingsBody')} />
      <div className="bb-grid bb-gridTwo">
        <Card title={t('settingsLocalTitle')} body={t('settingsLocalBody')} badge={t('planned')} />
        <Card title={t('settingsMirrorTitle')} body={t('settingsMirrorBody')} badge={t('planned')} />
      </div>
    </section>
  )
}

function SectionHead({ title, body }: { title: string; body: string }) {
  return (
    <div className="bb-sectionHead">
      <h2 className="bb-sectionTitle">{title}</h2>
      <p className="bb-sectionBody">{body}</p>
    </div>
  )
}

function Card({ title, body, badge }: { title: string; body: string; badge: string }) {
  return (
    <article className="bb-card">
      <div className="bb-cardTop">
        <h3 className="bb-cardTitle">{title}</h3>
        <span className="bb-badge">{badge}</span>
      </div>
      <p className="bb-cardBody">{body}</p>
    </article>
  )
}
