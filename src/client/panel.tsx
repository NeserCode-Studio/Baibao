import { useState, type KeyboardEvent } from 'react'
import { BackIcon, BaibaoIcon, SettingsIcon } from './icon'
import type { BaibaoKey } from './locales'

/** The framework's translate seat for the `dsh-baibao` namespace. */
export type TranslateBaibao = (key: BaibaoKey, params?: Record<string, unknown>) => string

export interface BaibaoPanelProps {
  /** Injected by the slot renderer because the registration declares `locale`. */
  t: TranslateBaibao
}

type SectionProps = BaibaoPanelProps & { hidden: boolean }
type View = 'chat' | 'settings'

const SETTINGS_TABS = [
  { id: 'memory', label: 'tabMemory' },
  { id: 'connections', label: 'tabConnections' },
  { id: 'settings', label: 'tabSettings' },
] as const satisfies readonly { id: string; label: BaibaoKey }[]

type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

/**
 * The 百宝 panel: a chat page, with memory/connections/settings moved behind
 * one settings action.
 *
 * M0 keeps the chat honest: the shell and composer are here, but sending is
 * disabled until M2 wires the native DSH session. The settings view is the
 * single home for everything that is not conversation.
 */
export function BaibaoPanel({ t }: BaibaoPanelProps) {
  const [view, setView] = useState<View>('chat')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('memory')

  return (
    <div className="bb-root">
      {view === 'chat' ? (
        <ChatView t={t} onOpenSettings={() => setView('settings')} />
      ) : (
        <SettingsView
          t={t}
          tab={settingsTab}
          onTab={setSettingsTab}
          onBack={() => setView('chat')}
        />
      )}
    </div>
  )
}

function ChatView({ t, onOpenSettings }: BaibaoPanelProps & { onOpenSettings: () => void }) {
  return (
    <div className="bb-chat">
      <header className="bb-chatHead">
        <span className="bb-chatName">{t('title')}</span>
        <button
          type="button"
          className="bb-iconBtn"
          onClick={onOpenSettings}
          aria-label={t('openSettings')}
          title={t('openSettings')}
        >
          <SettingsIcon />
        </button>
      </header>

      <div className="bb-chatBody">
        <div className="bb-chatEmpty">
          <span className="bb-chatEmptyMark">
            <BaibaoIcon size={34} />
          </span>
          <h1 className="bb-chatEmptyTitle">{t('chatEmptyTitle')}</h1>
          <p className="bb-chatEmptyHint">{t('chatEmptyHint')}</p>
        </div>
      </div>

      <div className="bb-chatFoot">
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
        <p className="bb-composerNote">{t('composerNote')}</p>
      </div>
    </div>
  )
}

function SettingsView({
  t,
  tab,
  onTab,
  onBack,
}: BaibaoPanelProps & {
  tab: SettingsTab
  onTab: (tab: SettingsTab) => void
  onBack: () => void
}) {
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: SettingsTab): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = SETTINGS_TABS.findIndex((item) => item.id === current)
    const next = SETTINGS_TABS[(index + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length]
    if (next === undefined) return
    onTab(next.id)
    document.getElementById(`bb-tab-${next.id}`)?.focus()
  }

  return (
    <div className="bb-settings">
      <header className="bb-settingsHead">
        <button
          type="button"
          className="bb-iconBtn"
          onClick={onBack}
          aria-label={t('backToChat')}
          title={t('backToChat')}
        >
          <BackIcon />
        </button>
        <h1 className="bb-settingsTitle">{t('settingsPanelTitle')}</h1>
      </header>

      <div className="bb-tabs" role="tablist" aria-label={t('settingsPanelTitle')}>
        {SETTINGS_TABS.map((item) => {
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
              onClick={() => onTab(item.id)}
              onKeyDown={(event) => onTabKeyDown(event, item.id)}
            >
              {t(item.label)}
            </button>
          )
        })}
      </div>

      <main className="bb-settingsBody">
        <MemorySection t={t} hidden={tab !== 'memory'} />
        <ConnectionsSection t={t} hidden={tab !== 'connections'} />
        <SettingsSection t={t} hidden={tab !== 'settings'} />
      </main>

      <footer className="bb-foot">
        <span>{t('footer')}</span>
        <span className="bb-local">{t('localOnly')}</span>
      </footer>
    </div>
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
