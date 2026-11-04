import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { BaibaoIcon } from './icon'
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
import { deleteMemory, listMemory, type MemoryEntry } from './memory-api'
import {
  DEFAULT_JUNG,
  DEFAULT_JUNG_TEXT,
  getPersona,
  savePersona,
  type JungAxis,
  type JungPersona,
} from './persona-api'

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
const SETTINGS_TABS = [
  { id: 'persona', label: 'tabPersona' },
  { id: 'memory', label: 'tabMemory' },
  { id: 'connections', label: 'tabConnections' },
  { id: 'settings', label: 'tabSettings' },
] as const satisfies readonly { id: string; label: BaibaoKey }[]

type SettingsTab = (typeof SETTINGS_TABS)[number]['id']

/**
 * The panel is a hub, not a second chat: a hero entry into the native
 * Conversation plus memory/connection/settings surfaces in one page.
 */
export function BaibaoPanel({ t, onPickDirectory, onStartChat }: BaibaoPanelProps) {
  const [tab, setTab] = useState<SettingsTab>('persona')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState(false)
  const [compact, setCompact] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const root = pageRef.current
    const hero = heroRef.current
    if (root === null || hero === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry !== undefined) setCompact(!entry.isIntersecting)
      },
      { root, threshold: 0 },
    )
    observer.observe(hero)
    return () => observer.disconnect()
  }, [])

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

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: SettingsTab): void => {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = SETTINGS_TABS.findIndex((item) => item.id === current)
    const next = SETTINGS_TABS[(index + delta + SETTINGS_TABS.length) % SETTINGS_TABS.length]
    if (next === undefined) return
    setTab(next.id)
    document.getElementById(`bb-tab-${next.id}`)?.focus()
  }

  return (
    <div className="bb-root">
      <div ref={pageRef} className="bb-page">
        <Hero
          t={t}
          heroRef={heroRef}
          onStartChat={onStartChat}
          starting={starting}
          startError={startError}
          onStart={() => void start()}
        />

        <CompactHeader
          t={t}
          open={compact}
          onStartChat={onStartChat}
          starting={starting}
          onStart={() => void start()}
        />

        <section className="bb-hub" aria-label={t('settingsPanelTitle')}>
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
                  onClick={() => setTab(item.id)}
                  onKeyDown={(event) => onTabKeyDown(event, item.id)}
                >
                  {t(item.label)}
                </button>
              )
            })}
          </div>

          <div className="bb-hubBody">
            <PersonaSection t={t} hidden={tab !== 'persona'} />
            <MemorySection t={t} hidden={tab !== 'memory'} />
            <ConnectionsSection t={t} hidden={tab !== 'connections'} />
            <SettingsSection
              t={t}
              hidden={tab !== 'settings'}
              onPickDirectory={onPickDirectory}
            />
          </div>
        </section>

        <footer className="bb-foot">
          <span>{t('footer')}</span>
          <span className="bb-local">{t('localOnly')}</span>
        </footer>
      </div>
    </div>
  )
}

interface HeroProps {
  t: BaibaoPanelProps['t']
  onStartChat?: () => Promise<void>
  starting: boolean
  startError: boolean
  onStart: () => void
}

const Hero = ({
  t,
  onStartChat,
  starting,
  startError,
  onStart,
  heroRef,
}: HeroProps & { heroRef: RefObject<HTMLElement> }) => (
  <section ref={heroRef} className="bb-hero">
    <span className="bb-heroMark">
      <BaibaoIcon size={46} />
    </span>
    <div className="bb-heroCopy">
      <h1 className="bb-heroTitle">{t('title')}</h1>
      <p className="bb-heroBody">{t('heroBody')}</p>
    </div>
    <div className="bb-heroSide">
      {onStartChat !== undefined ? (
        <button
          type="button"
          className="bb-heroAction"
          onClick={onStart}
          disabled={starting}
        >
          {starting ? t('startChatOpening') : t('startChat')}
        </button>
      ) : null}
      {startError && (
        <p className="bb-heroError" role="alert">
          {t('startChatFailed')}
        </p>
      )}
    </div>
  </section>
)

function CompactHeader({
  t,
  open,
  onStartChat,
  starting,
  onStart,
}: Omit<HeroProps, 'startError'> & { open: boolean }) {
  return (
    <div
      className={open ? 'bb-compactHead bb-compactHeadOpen' : 'bb-compactHead'}
      aria-hidden={!open}
    >
      <span className="bb-compactMark">
        <BaibaoIcon size={22} />
      </span>
      <span className="bb-compactMode">{t('title')}</span>
      {onStartChat !== undefined ? (
        <button
          type="button"
          className="bb-compactAction"
          onClick={onStart}
          disabled={starting}
          tabIndex={open ? 0 : -1}
        >
          {starting ? t('startChatOpening') : t('startChat')}
        </button>
      ) : null}
    </div>
  )
}

const JUNG_ROWS = [
  { axis: 'energy', title: 'jungEnergy', left: 'jungIntrovert', right: 'jungExtravert' },
  { axis: 'information', title: 'jungInformation', left: 'jungSensing', right: 'jungIntuition' },
  { axis: 'decisions', title: 'jungDecisions', left: 'jungThinking', right: 'jungFeeling' },
  { axis: 'lifestyle', title: 'jungLifestyle', left: 'jungJudging', right: 'jungPerceiving' },
] as const satisfies readonly {
  axis: JungAxis
  title: BaibaoKey
  left: BaibaoKey
  right: BaibaoKey
}[]

const JUNG_POINTS = [
  { label: 'E', axis: 'energy', positive: true, angle: -90 },
  { label: 'S', axis: 'information', positive: true, angle: -45 },
  { label: 'T', axis: 'decisions', positive: true, angle: 0 },
  { label: 'J', axis: 'lifestyle', positive: true, angle: 45 },
  { label: 'I', axis: 'energy', positive: false, angle: 90 },
  { label: 'N', axis: 'information', positive: false, angle: 135 },
  { label: 'F', axis: 'decisions', positive: false, angle: 180 },
  { label: 'P', axis: 'lifestyle', positive: false, angle: 225 },
] as const satisfies readonly {
  label: string
  axis: JungAxis
  positive: boolean
  angle: number
}[]

function JungChart({ persona, label }: { persona: JungPersona; label: string }) {
  const centerX = 130
  const centerY = 120
  const point = (angle: number, radius: number): [number, number] => {
    const radians = (angle * Math.PI) / 180
    return [centerX + Math.cos(radians) * radius, centerY + Math.sin(radians) * radius]
  }
  const valueOf = (entry: (typeof JUNG_POINTS)[number]): number =>
    50 + (persona[entry.axis] * (entry.positive ? 1 : -1)) / 2
  const ring = (radius: number): string =>
    JUNG_POINTS.map((entry) => point(entry.angle, radius).join(',')).join(' ')
  const shape = JUNG_POINTS.map((entry) =>
    point(entry.angle, 20 + (valueOf(entry) / 100) * 64).join(','),
  ).join(' ')

  return (
    <div className="bb-jungChart">
      <svg viewBox="0 0 260 250" role="img" aria-label={label}>
        {[20, 40, 60, 84].map((radius) => (
          <polygon
            key={radius}
            points={ring(radius)}
            fill="none"
            stroke="var(--dsw-alias-border-l3, #d9dee6)"
            strokeWidth="0.75"
          />
        ))}
        {JUNG_POINTS.map((entry) => {
          const [x, y] = point(entry.angle, 84)
          return (
            <line
              key={entry.label}
              x1={centerX}
              y1={centerY}
              x2={x}
              y2={y}
              stroke="var(--dsw-alias-border-l3, #d9dee6)"
              strokeWidth="0.75"
            />
          )
        })}
        <polygon
          points={shape}
          fill="var(--dsw-alias-brand-primary, #4f6ef7)"
          fillOpacity="0.18"
          stroke="var(--dsw-alias-brand-primary, #4f6ef7)"
          strokeWidth="1.5"
        />
        {JUNG_POINTS.map((entry) => {
          const [x, y] = point(entry.angle, 20 + (valueOf(entry) / 100) * 64)
          return (
            <circle
              key={`dot-${entry.label}`}
              cx={x}
              cy={y}
              r="2.5"
              fill="var(--dsw-alias-brand-primary, #4f6ef7)"
            />
          )
        })}
        {JUNG_POINTS.map((entry) => {
          const [x, y] = point(entry.angle, 100)
          const anchor = x < centerX - 4 ? 'end' : x > centerX + 4 ? 'start' : 'middle'
          return (
            <text
              key={`label-${entry.label}`}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize="11"
              fill="var(--dsw-alias-label-secondary, #5c6570)"
            >
              {entry.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function PersonaSection({ t, hidden }: SectionProps) {
  const [persona, setPersona] = useState<JungPersona>({ ...DEFAULT_JUNG })
  const [baseText, setBaseText] = useState(DEFAULT_JUNG_TEXT)
  const [defaultText, setDefaultText] = useState(DEFAULT_JUNG_TEXT)
  const [limit, setLimit] = useState(600)
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>(
    'loading',
  )

  useEffect(() => {
    let live = true
    void getPersona().then((result) => {
      if (!live) return
      if (result.ok) {
        setPersona(result.persona)
        setBaseText(result.text)
        setDefaultText(result.defaultText)
        setLimit(result.limit)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
    return () => {
      live = false
    }
  }, [])

  const update = (axis: JungAxis, value: number): void => {
    setPersona((current) => ({ ...current, [axis]: value }))
    setStatus('ready')
  }

  const save = async (text?: string): Promise<void> => {
    setStatus('saving')
    const result = await savePersona(persona, text)
    if (result.ok) {
      setPersona(result.persona)
      setBaseText(result.text)
      setDefaultText(result.defaultText)
      setLimit(result.limit)
      setStatus('saved')
    } else {
      setStatus('error')
    }
  }

  return (
    <section
      id="bb-panel-persona"
      role="tabpanel"
      aria-labelledby="bb-tab-persona"
      className="bb-section"
      hidden={hidden}
    >
      <SectionHead title={t('personaTitle')} body={t('personaBody')} />
      <div className="bb-persona">
        <JungChart persona={persona} label={t('personaChart')} />
        <div className="bb-jungControls">
          {JUNG_ROWS.map((row) => (
            <div key={row.axis} className="bb-jungRow">
              <div className="bb-jungRowTop">
                <span>{t(row.title)}</span>
                <span className="bb-jungValue">{persona[row.axis]}</span>
              </div>
              <input
                className="bb-jungRange"
                type="range"
                min="-100"
                max="100"
                step="5"
                value={persona[row.axis]}
                aria-label={t(row.title)}
                onChange={(event) => update(row.axis, Number(event.target.value))}
              />
              <div className="bb-jungPoles">
                <span>{t(row.left)}</span>
                <span>{t(row.right)}</span>
              </div>
            </div>
          ))}
          <div className="bb-personaActions">
            <button
              type="button"
              className="bb-personaBtn"
              onClick={() => void save()}
              disabled={status === 'saving'}
            >
              {t('personaSave')}
            </button>
            <button
              type="button"
              className="bb-secondaryBtn"
              onClick={() => {
                setPersona({ ...DEFAULT_JUNG })
                setStatus('ready')
              }}
              disabled={status === 'saving'}
            >
              {t('personaReset')}
            </button>
          </div>
          {status === 'saved' && (
            <p className="bb-storageOk" role="status">
              {t('personaSaved')}
            </p>
          )}
          {status === 'error' && (
            <p className="bb-storageError" role="alert">
              {t('personaFailed')}
            </p>
          )}
          <p className="bb-storageHint">{t('personaNewSession')}</p>
        </div>
      </div>

      <div className="bb-promptBlock">
        <div className="bb-jungRowTop">
          <span className="bb-jungBlockTitle">{t('promptTitle')}</span>
          <span className="bb-jungValue">
            {baseText.length}/{limit}
          </span>
        </div>
        <textarea
          id="bb-persona-text"
          className="bb-personaText"
          value={baseText}
          maxLength={limit}
          rows={8}
          spellCheck={false}
          onChange={(event) => {
            setBaseText(event.target.value)
            setStatus('ready')
          }}
        />
        <div className="bb-personaActions">
          <button
            type="button"
            className="bb-personaBtn"
            onClick={() => void save(baseText)}
            disabled={status === 'saving'}
          >
            {t('promptSave')}
          </button>
          <button
            type="button"
            className="bb-secondaryBtn"
            onClick={() => void save(defaultText)}
            disabled={status === 'saving'}
          >
            {t('promptReset')}
          </button>
        </div>
        <p className="bb-storageHint">{t('promptBody')}</p>
      </div>
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
      <MemoryList t={t} />
    </section>
  )
}

function MemoryList({ t }: BaibaoPanelProps) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void listMemory().then((result) => {
      if (!live) return
      if (result.ok) {
        setEntries(result.entries)
        setFailed(false)
      } else {
        setFailed(true)
      }
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [])

  const remove = async (id: string): Promise<void> => {
    const result = await deleteMemory(id)
    if (result.ok) {
      setEntries((current) => current.filter((entry) => entry.id !== id))
      setPendingDelete(null)
      setFailed(false)
    } else {
      setFailed(true)
    }
  }

  if (loading) return <p className="bb-memoryEmpty">{t('memoryLoading')}</p>
  if (failed) {
    return (
      <p className="bb-memoryError" role="alert">
        {t('memoryFailed')}
      </p>
    )
  }
  if (entries.length === 0) return <p className="bb-memoryEmpty">{t('memoryEmpty')}</p>

  return (
    <ul className="bb-memoryList">
      {entries.map((entry) => {
        const kindKey: BaibaoKey =
          entry.kind === 'preference'
            ? 'memoryKindPreference'
            : entry.kind === 'episode'
              ? 'memoryKindEpisode'
              : 'memoryKindFact'
        return (
          <li key={entry.id} className="bb-memoryItem">
            <div className="bb-memoryTop">
              <span className="bb-memoryKind">{t(kindKey)}</span>
              <span className="bb-memoryDate">
                {new Date(entry.createdAt).toLocaleDateString()}
              </span>
            </div>
            <p className="bb-memoryText">{entry.text}</p>
            {entry.tags.length > 0 && (
              <p className="bb-memoryTags">
                {entry.tags.map((tag) => (
                  <span key={tag} className="bb-memoryTag">
                    #{tag}
                  </span>
                ))}
              </p>
            )}
            {pendingDelete === entry.id ? (
              <div className="bb-memoryActions">
                <button
                  type="button"
                  className="bb-storageDangerLink"
                  onClick={() => void remove(entry.id)}
                >
                  {t('memoryDeleteConfirm')}
                </button>
                <button
                  type="button"
                  className="bb-storageLink"
                  onClick={() => setPendingDelete(null)}
                >
                  {t('memoryCancel')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="bb-storageLink"
                onClick={() => setPendingDelete(entry.id)}
              >
                {t('memoryDelete')}
              </button>
            )}
          </li>
        )
      })}
    </ul>
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
      <div className="bb-grid">
        <Card
          title={t('agentModeTitle')}
          body={t('agentModeBody')}
          badge={t('agentModeDefault')}
        />
      </div>
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
            <dt>{t('storageWorkspace')}</dt>
            <dd>{info.workspaceDir}</dd>
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
