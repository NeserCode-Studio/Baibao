import { useEffect, useState, type KeyboardEvent } from 'react'
import { BackIcon, BaibaoIcon, SettingsIcon } from './icon'
import type { BaibaoKey } from './locales'
import {
  createBackup,
  deleteBackup,
  getStorage,
  listBackups,
  setStorage,
  type StorageBackup,
  type StorageInfo,
  type StorageMigration,
} from './storage-api'

/** The framework's translate seat for the `dsh-baibao` namespace. */
export type TranslateBaibao = (key: BaibaoKey, params?: Record<string, unknown>) => string

export interface BaibaoPanelProps {
  /** Injected by the slot renderer because the registration declares `locale`. */
  t: TranslateBaibao
  /** Opens the host's native directory picker. */
  onPickDirectory?: () => Promise<string | null>
  /** Creates a Baibao workspace session and opens it in the native chat. */
  onStartChat?: () => Promise<void>
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
export function BaibaoPanel({ t, onPickDirectory, onStartChat }: BaibaoPanelProps) {
  const [view, setView] = useState<View>('chat')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('memory')

  return (
    <div className="bb-root">
      {view === 'chat' ? (
        <ChatView
          t={t}
          onOpenSettings={() => setView('settings')}
          onStartChat={onStartChat}
        />
      ) : (
        <SettingsView
          t={t}
          tab={settingsTab}
          onTab={setSettingsTab}
          onBack={() => setView('chat')}
          onPickDirectory={onPickDirectory}
        />
      )}
    </div>
  )
}

function ChatView({
  t,
  onOpenSettings,
  onStartChat,
}: BaibaoPanelProps & { onOpenSettings: () => void }) {
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(false)

  const start = async (): Promise<void> => {
    if (onStartChat === undefined || starting) return
    setStarting(true)
    setStartError(false)
    try {
      await onStartChat()
    } catch {
      setStartError(true)
    } finally {
      setStarting(false)
    }
  }

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
          {onStartChat !== undefined && (
            <button
              type="button"
              className="bb-chatAction"
              onClick={() => void start()}
              disabled={starting}
            >
              {starting ? t('startChatOpening') : t('startChat')}
            </button>
          )}
          {startError && (
            <p className="bb-chatError" role="alert">
              {t('startChatFailed')}
            </p>
          )}
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
  onPickDirectory,
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
        <SettingsSection t={t} hidden={tab !== 'settings'} onPickDirectory={onPickDirectory} />
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

function SettingsSection({ t, hidden, onPickDirectory }: SectionProps) {
  return (
    <section
      id="bb-panel-settings"
      role="tabpanel"
      aria-labelledby="bb-tab-settings"
      className="bb-section"
      hidden={hidden}
    >
      <SectionHead title={t('storageTitle')} body={t('storageBody')} />
      <StorageSettings t={t} onPickDirectory={onPickDirectory} />
      <SectionHead title={t('settingsTitle')} body={t('settingsBody')} />
      <div className="bb-grid bb-gridTwo">
        <Card title={t('settingsLocalTitle')} body={t('settingsLocalBody')} badge={t('planned')} />
        <Card title={t('settingsMirrorTitle')} body={t('settingsMirrorBody')} badge={t('planned')} />
      </div>
    </section>
  )
}

function StorageSettings({ t, onPickDirectory }: BaibaoPanelProps) {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  const [migration, setMigration] = useState<StorageMigration | null>(null)
  const [draft, setDraft] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')
  const [backups, setBackups] = useState<StorageBackup[]>([])
  const [pendingRoot, setPendingRoot] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupError, setBackupError] = useState(false)

  useEffect(() => {
    let live = true
    void Promise.all([getStorage(), listBackups()]).then(([storage, list]) => {
      if (!live) return
      if (storage.ok) {
        setInfo(storage.storage)
        setDraft(storage.storage.root)
        setStatus('ready')
      } else {
        setStatus('error')
      }
      if (list.ok) setBackups(list.backups)
    })
    return () => {
      live = false
    }
  }, [])

  const applySave = async (value: string): Promise<void> => {
    const root = value.trim()
    if (root === '') return
    setPendingRoot(null)
    setStatus('saving')
    setMigration(null)
    setBackupError(false)
    const result = await setStorage(root)
    if (result.ok) {
      setInfo(result.storage)
      setDraft(result.storage.root)
      setMigration(result.migration ?? null)
      setStatus('saved')
    } else {
      setStatus('error')
    }
  }

  const requestSave = (value: string): void => {
    const root = value.trim()
    if (root === '') return
    if (info !== null && root !== info.root) {
      setPendingRoot(root)
      return
    }
    void applySave(root)
  }

  const pick = async (): Promise<void> => {
    if (onPickDirectory === undefined) return
    try {
      const next = await onPickDirectory()
      if (next !== null && next.trim() !== '') {
        setDraft(next)
        setStatus('ready')
        setMigration(null)
      }
    } catch {
      setStatus('error')
    }
  }

  const addBackup = async (): Promise<void> => {
    setBackupBusy(true)
    setBackupError(false)
    const result = await createBackup()
    if (result.ok) setBackups(result.backups)
    else setBackupError(true)
    setBackupBusy(false)
  }

  const removeBackup = async (id: string): Promise<void> => {
    setBackupBusy(true)
    setBackupError(false)
    const result = await deleteBackup(id)
    if (result.ok) {
      setBackups(result.backups)
      setPendingDelete(null)
    } else {
      setBackupError(true)
    }
    setBackupBusy(false)
  }

  const busy = status === 'saving' || backupBusy

  return (
    <div className="bb-storage" aria-busy={busy}>
      {status === 'saving' && (
        <div className="bb-storageMask" role="status" aria-live="polite">
          <span className="bb-spinner" aria-hidden="true" />
          {t('storageMigrating')}
        </div>
      )}

      {pendingRoot !== null && (
        <div
          className="bb-confirmMask"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bb-migrate-confirm"
        >
          <div className="bb-confirm">
            <p id="bb-migrate-confirm" className="bb-confirmTitle">
              {t('storageMigrateConfirm')}
            </p>
            <p className="bb-confirmPath">{pendingRoot}</p>
            <div className="bb-confirmActions">
              <button
                type="button"
                className="bb-storageLink"
                onClick={() => setPendingRoot(null)}
              >
                {t('storageCancel')}
              </button>
              <button
                type="button"
                className="bb-storageBtn bb-storageDanger"
                onClick={() => {
                  if (pendingRoot !== null) void applySave(pendingRoot)
                }}
              >
                {t('storageMigrateContinue')}
              </button>
            </div>
          </div>
        </div>
      )}

      <label className="bb-storageLabel" htmlFor="bb-storage-path">
        {t('storagePath')}
      </label>
      <div className="bb-storageRow">
        <button
          id="bb-storage-path"
          type="button"
          className="bb-storagePath"
          onClick={() => void pick()}
          disabled={busy || onPickDirectory === undefined}
          title={draft !== '' ? draft : t('storagePathPlaceholder')}
          aria-label={t('storagePath')}
        >
          <span className="bb-storagePathText">{draft !== '' ? draft : t('storagePathPlaceholder')}</span>
          <span className="bb-storagePathBrowse">{t('storageBrowse')}</span>
        </button>
        <button
          type="button"
          className="bb-storageBtn"
          onClick={() => requestSave(draft)}
          disabled={busy || draft.trim() === ''}
        >
          {t('storageSave')}
        </button>
      </div>
      <div className="bb-storageActions">
        <button
          type="button"
          className="bb-storageLink"
          onClick={() => {
            if (info !== null) requestSave(info.defaultRoot)
          }}
          disabled={info === null || busy}
        >
          {t('storageReset')}
        </button>
      </div>

      {info !== null && (
        <dl className="bb-storageMeta">
          <div>
            <dt>{t('storageDefault')}</dt>
            <dd>{info.defaultRoot}</dd>
          </div>
          <div>
            <dt>{t('storageMemory')}</dt>
            <dd>{info.memoryDir}</dd>
          </div>
          <div>
            <dt>{t('storageConfig')}</dt>
            <dd>{info.configFile}</dd>
          </div>
        </dl>
      )}

      {status === 'saved' && migration !== null && migration.files > 0 && (
        <p className="bb-storageOk" role="status">
          {t('storageMigrated', { files: migration.files, backups: migration.backups })}
        </p>
      )}
      {status === 'saved' && (migration === null || migration.files === 0) && (
        <p className="bb-storageOk" role="status">
          {t('storageSaved')}
        </p>
      )}
      {status === 'saved' && migration !== null && migration.oldDeleted && (
        <p className="bb-storageHint">{t('storageOldDeleted')}</p>
      )}
      {status === 'saved' && migration !== null && !migration.oldDeleted && (
        <p className="bb-storageError" role="alert">
          {t('storageOldDeleteFailed')}
        </p>
      )}
      {status === 'error' && (
        <p className="bb-storageError" role="alert">
          {t('storageFailed')}
        </p>
      )}

      <div className="bb-backups">
        <div className="bb-backupsHead">
          <span className="bb-backupsTitle">{t('storageBackups')}</span>
          <button
            type="button"
            className="bb-storageBtn"
            onClick={() => void addBackup()}
            disabled={busy}
          >
            {t('storageBackupCreate')}
          </button>
        </div>
        {backups.length === 0 ? (
          <p className="bb-storageHint">{t('storageBackupEmpty')}</p>
        ) : (
          <ul className="bb-backupList">
            {backups.map((backup) => (
              <li key={backup.id} className="bb-backupItem">
                <span className="bb-backupName" title={backup.path}>
                  {backup.createdAt ?? backup.id}
                </span>
                <span className="bb-backupMeta">
                  {backup.files !== null ? t('storageBackupFiles', { n: backup.files }) : ''}
                </span>
                {pendingDelete === backup.id ? (
                  <span className="bb-backupActions">
                    <button
                      type="button"
                      className="bb-storageDangerLink"
                      onClick={() => void removeBackup(backup.id)}
                      disabled={backupBusy}
                    >
                      {t('storageDeleteConfirm')}
                    </button>
                    <button
                      type="button"
                      className="bb-storageLink"
                      onClick={() => setPendingDelete(null)}
                      disabled={backupBusy}
                    >
                      {t('storageCancel')}
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="bb-storageLink"
                    onClick={() => setPendingDelete(backup.id)}
                    disabled={busy}
                  >
                    {t('storageDelete')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="bb-storageHint">{t('storageBackupHint')}</p>
        {backupError && (
          <p className="bb-storageError" role="alert">
            {t('storageBackupFailed')}
          </p>
        )}
      </div>
    </div>
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
