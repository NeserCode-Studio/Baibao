import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
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
import { deleteMemory, listMemory, MEMORY_PAGE_SIZE, type MemoryEntry } from './memory-api'
import {
  deleteNotification,
  listNotifications,
  updateNotification,
  NOTIFICATION_PAGE_SIZE,
  type NotificationEntry,
} from './notifications-api'
import { getConfig, saveConsolidationModel, type ModelChoice } from './config-api'
import { getPush, savePush, type PushState } from './push-api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'
import { Label } from './ui/label'
import { Switch } from './ui/switch'
import { cn } from './ui/utils'
import { Input } from './ui/input'
import {
  getChannels,
  pollWechatQr,
  requestWechatQr,
  saveChannel,
  saveIdentity,
  type ChannelInfo,
  type ChannelStatusEntry,
  type IdentityView,
  type QrCode,
} from './channels-api'
import {
  DEFAULT_JUNG,
  DEFAULT_JUNG_TEXT,
  getPersona,
  savePersona,
  type JungAxis,
  type JungPersona,
  type PersonaAuditNote,
  type PersonaPreset,
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
  const [preset, setPreset] = useState<string | null>(null)
  const [presets, setPresets] = useState<PersonaPreset[]>([])
  const [audit, setAudit] = useState<PersonaAuditNote[]>([])
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
        setPreset(result.preset)
        setPresets(result.presets)
        setAudit(result.audit)
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

  const applyPreset = (id: string): void => {
    const found = presets.find((item) => item.id === id)
    if (found === undefined) return
    setPersona({ ...found.jung })
    setPreset(id)
    setStatus('ready')
  }

  const save = async (text?: string, presetId?: string | null): Promise<void> => {
    setStatus('saving')
    const result = await savePersona(persona, text, presetId === undefined ? preset : presetId)
    if (result.ok) {
      setPersona(result.persona)
      setPreset(result.preset)
      setAudit(result.audit)
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
      <div className="bb-presetRow" role="group" aria-label={t('personaPresetTitle')}>
        {presets.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === preset ? 'bb-preset bb-presetActive' : 'bb-preset'}
            aria-pressed={item.id === preset}
            title={item.summary}
            onClick={() => applyPreset(item.id)}
            disabled={status === 'saving'}
          >
            {item.name}
          </button>
        ))}
      </div>
      <p className="bb-storageHint">{t('personaPresetBody')}</p>
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
                setPreset('balanced')
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
          {audit.map((note) => (
            <p
              key={note.text}
              className={note.level === 'warn' ? 'bb-personaWarn' : 'bb-storageHint'}
              role={note.level === 'warn' ? 'alert' : undefined}
            >
              {note.text}
            </p>
          ))}
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
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [pageSize, setPageSize] = useState(MEMORY_PAGE_SIZE)
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  // Typing hits the host, so debounce before committing the query.
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedQuery(query.trim())
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let live = true
    setLoading(true)
    void listMemory(appliedQuery, page).then((result) => {
      if (!live) return
      if (result.ok) {
        setEntries(result.entries)
        setTotal(result.total)
        setPage(result.page)
        setPageCount(result.pageCount)
        setPageSize(result.pageSize)
        setFailed(false)
      } else {
        setFailed(true)
      }
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [appliedQuery, page])

  const remove = async (id: string): Promise<void> => {
    const result = await deleteMemory(id)
    if (!result.ok) {
      setFailed(true)
      return
    }
    setPendingDelete(null)
    setFailed(false)
    // Deleting the last row of a page leaves it empty; step back instead of
    // showing a blank page with no way forward.
    if (entries.length === 1 && page > 1) {
      setPage(page - 1)
      return
    }
    const refreshed = await listMemory(appliedQuery, page)
    if (refreshed.ok) {
      setEntries(refreshed.entries)
      setTotal(refreshed.total)
      setPage(refreshed.page)
      setPageCount(refreshed.pageCount)
    }
  }

  const kindLabel = (kind: MemoryEntry['kind']): BaibaoKey =>
    kind === 'preference'
      ? 'memoryKindPreference'
      : kind === 'episode'
        ? 'memoryKindEpisode'
        : 'memoryKindFact'

  const showPager = total > pageSize

  const search = (
    <div className="bb-memorySearch">
      <input
        type="search"
        className="bb-memorySearchInput"
        value={query}
        placeholder={t('memorySearchPlaceholder')}
        aria-label={t('memorySearch')}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query !== '' && (
        <button
          type="button"
          className="bb-storageLink"
          onClick={() => setQuery('')}
        >
          {t('memorySearchClear')}
        </button>
      )}
    </div>
  )

  const pager = showPager ? (
    <nav className="bb-pager" aria-label={t('memoryPager')}>
      <button
        type="button"
        className="bb-secondaryBtn"
        disabled={page <= 1}
        onClick={() => setPage(page - 1)}
      >
        {t('memoryPrev')}
      </button>
      <span className="bb-pagerStatus">
        {t('memoryPageOf', { page, count: pageCount })}
      </span>
      <button
        type="button"
        className="bb-secondaryBtn"
        disabled={page >= pageCount}
        onClick={() => setPage(page + 1)}
      >
        {t('memoryNext')}
      </button>
    </nav>
  ) : null

  const body = (() => {
    if (loading) return <p className="bb-memoryEmpty">{t('memoryLoading')}</p>
    if (failed) {
      return (
        <p className="bb-memoryError" role="alert">
          {t('memoryFailed')}
        </p>
      )
    }
    if (entries.length === 0) {
      // An empty search result reads differently from an empty store.
      return (
        <p className="bb-memoryEmpty">
          {appliedQuery === '' ? t('memoryEmpty') : t('memoryNoMatch')}
        </p>
      )
    }
    return (
      <ul className="bb-memoryList">
        {entries.map((entry) => (
          <li key={entry.id} className="bb-memoryItem">
            <div className="bb-memoryTop">
              <span className="bb-memoryKind">{t(kindLabel(entry.kind))}</span>
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
        ))}
      </ul>
    )
  })()

  return (
    <div className="bb-memoryPanel">
      {search}
      {body}
      {pager}
    </div>
  )
}

/**
 * WeChat connection: scan a QR code, nothing to type.
 *
 * The login is a two-step HTTP flow (ask for a code, poll its status), so the
 * panel drives the polling itself and stops as soon as the scan lands or the
 * code expires. An expired session is shown plainly — iLink has no refresh, and
 * pretending otherwise would leave the user waiting for a bot that cannot reply.
 */
function WechatChannel({ t }: { t: TranslateBaibao }) {
  const [channel, setChannel] = useState<ChannelInfo | null>(null)
  const [status, setStatus] = useState<ChannelStatusEntry>({ state: 'unknown' })
  const [qr, setQr] = useState<QrCode | null>(null)
  const [qrState, setQrState] = useState('')
  const [users, setUsers] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'busy' | 'error'>('loading')

  const applyChannel = (next: ChannelInfo): void => {
    setChannel(next)
    setUsers(next.allowedUsers.join(', '))
  }

  const refresh = useCallback((): void => {
    void getChannels().then((result) => {
      if (!result.ok) return
      const wx = result.channels.find((item) => item.id === 'wechat')
      if (wx !== undefined) applyChannel(wx)
      setStatus(result.status.wechat ?? { state: 'unknown' })
    })
  }, [])

  useEffect(() => {
    let live = true
    void getChannels().then((result) => {
      if (!live) return
      if (result.ok) {
        const wx = result.channels.find((item) => item.id === 'wechat')
        if (wx !== undefined) applyChannel(wx)
        setStatus(result.status.wechat ?? { state: 'unknown' })
        setPhase('ready')
      } else {
        setPhase('error')
      }
    })
    return () => {
      live = false
    }
  }, [])

  // Keep following the connection while it is still settling. Without this the
  // badge sticks on "connecting" until the tab remounts, because the login
  // callback fires before the runner has actually connected.
  useEffect(() => {
    if (status.state !== 'connecting' && status.state !== 'reconnecting') return undefined
    const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [status.state, refresh])

  // Poll while a code is on screen.
  useEffect(() => {
    if (qr === null || qrState === 'done') return undefined
    const timer = setInterval(() => {
      void pollWechatQr(qr.qrcode).then((result) => {
        if (!result.ok) return
        setQrState(result.state.status)
        if (result.state.done) {
          setQr(null)
          // The scan succeeded but the runner is only starting up; `refresh`
          // above carries the badge the rest of the way to "connected".
          refresh()
        } else if (result.state.expired) {
          setQr(null)
        }
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [qr, qrState, refresh])

  const startScan = (): void => {
    setPhase('busy')
    setQrState('')
    void requestWechatQr().then((result) => {
      if (result.ok) {
        setQr(result.qr)
        setQrState('wait')
        setPhase('ready')
      } else {
        setPhase('error')
      }
    })
  }

  const saveUsers = (): void => {
    setPhase('busy')
    void saveChannel('wechat', {
      allowedUsers: users
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    }).then((result) => {
      if (result.ok) {
        applyChannel(result.channel)
        setPhase('ready')
      } else {
        setPhase('error')
      }
    })
  }

  const connected = channel?.configured === true
  const stateKey: BaibaoKey =
    status.state === 'ready'
      ? 'channelStateReady'
      : status.state === 'expired'
        ? 'channelStateExpired'
        : status.state === 'connecting' || status.state === 'reconnecting'
          ? 'channelStateConnecting'
          : status.state === 'error'
            ? 'channelStateError'
            : 'channelStateIdle'

  return (
    <div className="bb-channel">
      <div className="bb-jungRowTop">
        <span className="bb-jungBlockTitle">{t('channelWechatTitle')}</span>
        <span
          className={status.state === 'ready' ? 'bb-channelStateOk' : 'bb-channelState'}
          role="status"
        >
          {t(stateKey)}
        </span>
      </div>
      <p className="bb-storageHint">{t('channelWechatBody')}</p>

      {qr !== null && (
        <div className="bb-channelQr">
          {qr.image !== '' ? (
            <img src={qr.image} alt={t('channelWechatScan')} />
          ) : (
            // Encoding can fail; the raw URL still works when opened elsewhere.
            <a className="bb-storageHint" href={qr.url} target="_blank" rel="noreferrer">
              {qr.url}
            </a>
          )}
          <p className="bb-storageHint">
            {qrState === 'scaned' ? t('channelWechatScanned') : t('channelWechatScan')}
          </p>
        </div>
      )}

      <div className="bb-personaActions">
        <button type="button" className="bb-personaBtn" onClick={startScan} disabled={phase === 'busy'}>
          {connected ? t('channelWechatRelogin') : t('channelWechatLogin')}
        </button>
      </div>

      <div className="bb-channelRow">
        <label className="bb-consolidationLabel" htmlFor="bb-wx-users">
          {t('channelAllowedUsers')}
        </label>
        <input
          id="bb-wx-users"
          type="text"
          className="bb-memorySearchInput"
          value={users}
          spellCheck={false}
          placeholder={t('channelAllowedUsersHint')}
          onChange={(event) => {
            setUsers(event.target.value)
            setPhase('ready')
          }}
        />
      </div>
      <p className="bb-storageHint">{t('channelAllowedUsersBody')}</p>

      <div className="bb-personaActions">
        <button type="button" className="bb-personaBtn" onClick={saveUsers} disabled={phase === 'busy'}>
          {t('consolidationSave')}
        </button>
      </div>

      {phase === 'error' && (
        <p className="bb-storageError" role="alert">
          {t('channelFailed')}
        </p>
      )}
    </div>
  )
}

/**
 * Bind the same person's two platform ids.
 *
 * Without the link the agent cannot tell that its QQ conversation and its
 * WeChat conversation belong to one person, and will answer "I have no
 * conversation with you there". The ids are long and meaningless, so the panel
 * shows a masked form and treats an empty field as "leave it alone".
 */
function IdentityCard({ t }: { t: TranslateBaibao }) {
  const [identity, setIdentity] = useState<IdentityView>({ qq: '', wechat: '', bound: false })
  const [qq, setQq] = useState('')
  const [wechat, setWechat] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'busy' | 'saved' | 'error'>('loading')

  useEffect(() => {
    let live = true
    void getChannels().then((result) => {
      if (!live) return
      if (result.ok) {
        setIdentity(result.identity)
        setPhase('ready')
      } else {
        setPhase('error')
      }
    })
    return () => {
      live = false
    }
  }, [])

  const submit = (): void => {
    setPhase('busy')
    void saveIdentity({
      ...(qq === '' ? {} : { qq }),
      ...(wechat === '' ? {} : { wechat }),
    }).then((result) => {
      if (result.ok) {
        setIdentity(result.identity)
        setQq('')
        setWechat('')
        setPhase('saved')
      } else {
        setPhase('error')
      }
    })
  }

  return (
    <div className="bb-channel">
      <div className="bb-jungRowTop">
        <span className="bb-jungBlockTitle">{t('identityTitle')}</span>
        <span className={identity.bound ? 'bb-channelStateOk' : 'bb-channelState'} role="status">
          {identity.bound ? t('identityBound') : t('identityUnbound')}
        </span>
      </div>
      <p className="bb-storageHint">{t('identityBody')}</p>

      {identity.bound && (
        <p className="bb-storageHint">
          QQ <code>{identity.qq}</code> · 微信 <code>{identity.wechat}</code>
        </p>
      )}

      <div className="bb-channelRow">
        <label className="bb-consolidationLabel" htmlFor="bb-id-qq">
          QQ
        </label>
        <input
          id="bb-id-qq"
          type="text"
          className="bb-memorySearchInput"
          value={qq}
          spellCheck={false}
          autoComplete="off"
          placeholder={identity.qq === '' ? t('identityPlaceholder') : identity.qq}
          onChange={(event) => {
            setQq(event.target.value)
            setPhase('ready')
          }}
        />
      </div>

      <div className="bb-channelRow">
        <label className="bb-consolidationLabel" htmlFor="bb-id-wx">
          微信
        </label>
        <input
          id="bb-id-wx"
          type="text"
          className="bb-memorySearchInput"
          value={wechat}
          spellCheck={false}
          autoComplete="off"
          placeholder={identity.wechat === '' ? t('identityPlaceholder') : identity.wechat}
          onChange={(event) => {
            setWechat(event.target.value)
            setPhase('ready')
          }}
        />
      </div>

      <div className="bb-personaActions">
        <button type="button" className="bb-personaBtn" onClick={submit} disabled={phase === 'busy'}>
          {t('consolidationSave')}
        </button>
      </div>

      {phase === 'saved' && (
        <p className="bb-storageOk" role="status">
          {t('consolidationSaved')}
        </p>
      )}
      {phase === 'error' && (
        <p className="bb-storageError" role="alert">
          {t('channelFailed')}
        </p>
      )}
    </div>
  )
}

/**
 * Push settings: when Baibao may interrupt, and how often.
 *
 * These were fixed at their documented defaults before; the rule gate honoured
 * quiet hours and a daily budget that nobody could edit.
 */
function PushSettingsCard({ t }: { t: TranslateBaibao }) {
  const [state, setState] = useState<PushState | null>(null)
  const [enabled, setEnabled] = useState(true)
  const [focusMode, setFocusMode] = useState(false)
  const [budget, setBudget] = useState('3')
  const [start, setStart] = useState('22:00')
  const [end, setEnd] = useState('08:00')
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')

  const apply = (next: PushState): void => {
    setState(next)
    setEnabled(next.settings.enabled)
    setFocusMode(next.settings.focusMode)
    setBudget(String(next.settings.dailyBudget))
    setStart(next.settings.quietHours.start)
    setEnd(next.settings.quietHours.end)
  }

  useEffect(() => {
    let live = true
    void getPush().then((result) => {
      if (!live) return
      if (result.ok) {
        apply(result)
        setPhase('ready')
      } else {
        setPhase('error')
      }
    })
    return () => {
      live = false
    }
  }, [])

  const submit = (): void => {
    setPhase('saving')
    void savePush({
      enabled,
      focusMode,
      dailyBudget: Number(budget),
      quietHours: { start, end },
    }).then((result) => {
      if (result.ok) {
        apply(result)
        setPhase('saved')
      } else {
        setPhase('error')
      }
    })
  }

  return (
    <div className="bb-channel">
      <div className="bb-jungRowTop">
        <span className="bb-jungBlockTitle">{t('pushTitle')}</span>
        {state !== null && (
          <span className="bb-channelState">
            {t('pushToday').replace('{count}', String(state.notifiedToday))}
          </span>
        )}
      </div>
      <p className="bb-storageHint">{t('pushBody')}</p>

      <label className="bb-channelToggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked)
            setPhase('ready')
          }}
        />
        <span>{t('pushEnabled')}</span>
      </label>

      <label className="bb-channelToggle">
        <input
          type="checkbox"
          checked={focusMode}
          onChange={(event) => {
            setFocusMode(event.target.checked)
            setPhase('ready')
          }}
        />
        <span>{t('pushFocus')}</span>
      </label>

      <div className="bb-channelRow">
        <label className="bb-consolidationLabel">{t('pushQuietHours')}</label>
        <input
          type="time"
          className="bb-memorySearchInput"
          value={start}
          onChange={(event) => {
            setStart(event.target.value)
            setPhase('ready')
          }}
        />
        <span className="bb-storageHint">—</span>
        <input
          type="time"
          className="bb-memorySearchInput"
          value={end}
          onChange={(event) => {
            setEnd(event.target.value)
            setPhase('ready')
          }}
        />
      </div>

      <div className="bb-channelRow">
        <label className="bb-consolidationLabel" htmlFor="bb-push-budget">
          {t('pushBudget')}
        </label>
        <input
          id="bb-push-budget"
          type="number"
          min={0}
          max={50}
          className="bb-memorySearchInput"
          value={budget}
          onChange={(event) => {
            setBudget(event.target.value)
            setPhase('ready')
          }}
        />
      </div>
      <p className="bb-storageHint">{t('pushBudgetBody')}</p>

      <div className="bb-personaActions">
        <button
          type="button"
          className="bb-personaBtn"
          onClick={submit}
          disabled={phase === 'loading' || phase === 'saving'}
        >
          {t('consolidationSave')}
        </button>
      </div>

      {phase === 'saved' && (
        <p className="bb-storageOk" role="status">
          {t('consolidationSaved')}
        </p>
      )}
      {phase === 'error' && (
        <p className="bb-storageError" role="alert">
          {t('channelFailed')}
        </p>
      )}
    </div>
  )
}

/**
 * QQ bot connection form.
 *
 * The secret is write-only: the host never sends it back, so the field starts
 * empty and an empty submit means "keep what is stored". That is why the hint
 * under the field says whether a secret already exists.
 */
/** Small labelled field: the label sits above so long values never crowd it. */
function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint !== undefined && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

/** Map a connection state onto the badge's tones. */
/** Dot colour for a connection state, used inside the shadcn Badge. */
function stateDot(state: string): string {
  if (state === 'ready') return 'bg-emerald-500'
  if (state === 'connecting' || state === 'reconnecting') return 'bg-amber-500'
  if (state === 'error' || state === 'fatal' || state === 'expired') return 'bg-red-500'
  return 'bg-muted-foreground'
}

/**
 * Connection state as a dot plus a word.
 *
 * A filled colour block reads as a button and pulls the eye away from the
 * settings; a dot carries the same signal at a fraction of the weight.
 */
function QqChannel({ t }: { t: TranslateBaibao }) {
  const [channel, setChannel] = useState<ChannelInfo | null>(null)
  const [status, setStatus] = useState<ChannelStatusEntry>({ state: 'unknown' })
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [users, setUsers] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')

  const applyChannel = (next: ChannelInfo): void => {
    setChannel(next)
    setAppId(next.appId)
    setUsers(next.allowedUsers.join(', '))
    setEnabled(next.enabled)
    setAppSecret('')
  }

  useEffect(() => {
    let live = true
    void getChannels().then((result) => {
      if (!live) return
      if (result.ok) {
        const qq = result.channels.find((item) => item.id === 'qq')
        if (qq !== undefined) applyChannel(qq)
        setStatus(result.status.qq ?? { state: 'unknown' })
        setPhase('ready')
      } else {
        setPhase('error')
      }
    })
    return () => {
      live = false
    }
  }, [])

  // Follow the connection while it settles, so saving does not leave the badge
  // stuck on "connecting" until the tab is remounted.
  useEffect(() => {
    if (status.state !== 'connecting' && status.state !== 'reconnecting') return undefined
    const timer = setInterval(() => {
      void getChannels().then((result) => {
        if (!result.ok) return
        setStatus(result.status.qq ?? { state: 'unknown' })
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [status.state])

  const save = async (patch: Parameters<typeof saveChannel>[1]): Promise<void> => {
    setPhase('saving')
    const result = await saveChannel('qq', patch)
    if (result.ok) {
      applyChannel(result.channel)
      setPhase('saved')
    } else {
      setPhase('error')
    }
  }

  const submit = (): void => {
    void save({
      enabled,
      appId,
      // Empty means "leave the stored secret alone".
      ...(appSecret === '' ? {} : { appSecret }),
      allowedUsers: users
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    })
  }

  const stateKey: BaibaoKey =
    status.state === 'ready'
      ? 'channelStateReady'
      : status.state === 'connecting' || status.state === 'reconnecting'
        ? 'channelStateConnecting'
        : status.state === 'error' || status.state === 'fatal'
          ? 'channelStateError'
          : 'channelStateIdle'

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('channelQqTitle')}</CardTitle>
          <CardDescription>{t('channelQqBody')}</CardDescription>
        </div>
        <Badge variant="outline" className="gap-1.5 rounded-full font-medium" role="status">
          <span className={cn('size-1.5 rounded-full', stateDot(status.state))} aria-hidden="true" />
          {t(stateKey)}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-3.5">
        <Field label={t('channelAppId')} htmlFor="bb-qq-appid">
          <Input
            id="bb-qq-appid"
            className="h-8"
            value={appId}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setAppId(event.target.value)
              setPhase('ready')
            }}
          />
        </Field>

        <Field label={t('channelAppSecret')} htmlFor="bb-qq-secret">
          <Input
            id="bb-qq-secret"
            type="password"
            className="h-8"
            value={appSecret}
            spellCheck={false}
            autoComplete="new-password"
            placeholder={channel?.hasSecret === true ? t('channelSecretStored') : ''}
            onChange={(event) => {
              setAppSecret(event.target.value)
              setPhase('ready')
            }}
          />
        </Field>

        <Field
          label={t('channelAllowedUsers')}
          htmlFor="bb-qq-users"
          hint={t('channelAllowedUsersBody')}
        >
          <Input
            id="bb-qq-users"
            className="h-8"
            value={users}
            spellCheck={false}
            placeholder={t('channelAllowedUsersHint')}
            onChange={(event) => {
              setUsers(event.target.value)
              setPhase('ready')
            }}
          />
        </Field>

        <div className="flex items-center gap-2.5">
          <Switch
            id="bb-qq-enabled"
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked)
              setPhase('ready')
            }}
          />
          <Label htmlFor="bb-qq-enabled" className="cursor-pointer normal-case tracking-normal text-[12px]">
            {t('channelEnable')}
          </Label>
        </div>
      </CardContent>

      <CardFooter>
        <Button className="h-8 px-3.5" onClick={submit} disabled={phase === 'loading' || phase === 'saving'}>
          {t('consolidationSave')}
        </Button>
        {channel?.hasSecret === true && (
          <Button
            variant="ghost"
            className="h-8 px-3"
            onClick={() => void save({ clearSecret: true })}
            disabled={phase === 'loading' || phase === 'saving'}
          >
            {t('channelClearSecret')}
          </Button>
        )}
        {phase === 'saved' && (
          <span className="text-[11px] font-medium text-emerald-600" role="status">
            {t('consolidationSaved')}
          </span>
        )}
        {phase === 'error' && (
          <span className="text-[11px] font-medium text-destructive" role="alert">
            {t('channelFailed')}
          </span>
        )}
      </CardFooter>
    </Card>
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
      <QqChannel t={t} />

      <WechatChannel t={t} />
      <IdentityCard t={t} />
      <PushSettingsCard t={t} />
      <div className="bb-grid bb-gridTwo">
        <InfoCard title={t('connectionsQuietTitle')} body={t('connectionsQuietBody')} badge={t('planned')} />
        <InfoCard title={t('connectionsTriggerTitle')} body={t('connectionsTriggerBody')} badge={t('planned')} />
      </div>
      <Inbox t={t} />
    </section>
  )
}

/**
 * Inbox: everything Baibao wanted to surface, including items the rule gate
 * held back during quiet hours or past the daily budget.
 */
function Inbox({ t }: { t: TranslateBaibao }) {
  const [entries, setEntries] = useState<NotificationEntry[]>([])
  const [unread, setUnread] = useState(0)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [pageSize, setPageSize] = useState(NOTIFICATION_PAGE_SIZE)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const load = async (nextPage: number): Promise<void> => {
    const result = await listNotifications('', nextPage)
    if (result.ok) {
      setEntries(result.entries)
      setUnread(result.unread)
      setTotal(result.total)
      setPage(result.page)
      setPageCount(result.pageCount)
      setPageSize(result.pageSize)
      setStatus('ready')
    } else {
      setStatus('error')
    }
  }

  useEffect(() => {
    let live = true
    void listNotifications('', 1).then((result) => {
      if (!live) return
      if (result.ok) {
        setEntries(result.entries)
        setUnread(result.unread)
        setTotal(result.total)
        setPage(result.page)
        setPageCount(result.pageCount)
        setPageSize(result.pageSize)
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
    return () => {
      live = false
    }
  }, [])

  const markRead = async (id: string): Promise<void> => {
    const result = await updateNotification(id, { status: 'read' })
    if (result.ok) {
      setEntries((current) => current.map((item) => (item.id === id ? result.entry : item)))
      setUnread(result.unread)
    } else {
      setStatus('error')
    }
  }

  const dismiss = async (id: string): Promise<void> => {
    const result = await updateNotification(id, { status: 'dismissed' })
    if (result.ok) {
      setEntries((current) => current.map((item) => (item.id === id ? result.entry : item)))
      setUnread(result.unread)
    } else {
      setStatus('error')
    }
  }

  const remove = async (id: string): Promise<void> => {
    const result = await deleteNotification(id)
    setPendingDelete(null)
    if (!result.ok) {
      setStatus('error')
      return
    }
    setUnread(result.unread)
    if (entries.length === 1 && page > 1) {
      await load(page - 1)
      return
    }
    await load(page)
  }

  const header = (
    <div className="bb-inboxHead">
      <span className="bb-jungBlockTitle">{t('inboxTitle')}</span>
      {unread > 0 && <span className="bb-inboxUnread">{t('inboxUnread', { n: unread })}</span>}
    </div>
  )

  if (status === 'loading') {
    return (
      <div className="bb-inbox">
        {header}
        <p className="bb-memoryEmpty">{t('inboxLoading')}</p>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="bb-inbox">
        {header}
        <p className="bb-memoryError" role="alert">
          {t('inboxFailed')}
        </p>
      </div>
    )
  }
  if (entries.length === 0) {
    return (
      <div className="bb-inbox">
        {header}
        <p className="bb-memoryEmpty">{t('inboxEmpty')}</p>
      </div>
    )
  }

  return (
    <div className="bb-inbox">
      {header}
      <ul className="bb-memoryList">
        {entries.map((entry) => {
          const priorityKey: BaibaoKey =
            entry.priority === 'P0'
              ? 'inboxPriorityP0'
              : entry.priority === 'P1'
                ? 'inboxPriorityP1'
                : 'inboxPriorityP2'
          return (
            <li
              key={entry.id}
              className={
                entry.status === 'unread' ? 'bb-memoryItem bb-inboxItemUnread' : 'bb-memoryItem'
              }
            >
              <div className="bb-memoryTop">
                <span className="bb-memoryKind">{t(priorityKey)}</span>
                <span className="bb-memoryDate">
                  {entry.createdAt === ''
                    ? ''
                    : new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
              {entry.title !== '' && <p className="bb-inboxTitle">{entry.title}</p>}
              {entry.body !== '' && <p className="bb-memoryText">{entry.body}</p>}
              {entry.reason !== '' && (
                <p className="bb-storageHint">{t('inboxReason', { reason: entry.reason })}</p>
              )}
              {entry.status !== 'unread' && (
                <p className="bb-storageHint">
                  {entry.status === 'dismissed' ? t('inboxDismissed') : t('inboxRead')}
                </p>
              )}
              <div className="bb-memoryActions">
                {entry.status === 'unread' && (
                  <button
                    type="button"
                    className="bb-storageLink"
                    onClick={() => void markRead(entry.id)}
                  >
                    {t('inboxMarkRead')}
                  </button>
                )}
                {entry.status !== 'dismissed' && (
                  <button
                    type="button"
                    className="bb-storageLink"
                    onClick={() => void dismiss(entry.id)}
                  >
                    {t('inboxDismiss')}
                  </button>
                )}
                {pendingDelete === entry.id ? (
                  <>
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
                  </>
                ) : (
                  <button
                    type="button"
                    className="bb-storageLink"
                    onClick={() => setPendingDelete(entry.id)}
                  >
                    {t('memoryDelete')}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {total > pageSize && (
        <nav className="bb-pager" aria-label={t('inboxPager')}>
          <button
            type="button"
            className="bb-secondaryBtn"
            disabled={page <= 1}
            onClick={() => void load(page - 1)}
          >
            {t('memoryPrev')}
          </button>
          <span className="bb-pagerStatus">{t('memoryPageOf', { page, count: pageCount })}</span>
          <button
            type="button"
            className="bb-secondaryBtn"
            disabled={page >= pageCount}
            onClick={() => void load(page + 1)}
          >
            {t('memoryNext')}
          </button>
        </nav>
      )}
    </div>
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
        <InfoCard
          title={t('agentModeTitle')}
          body={t('agentModeBody')}
          badge={t('agentModeDefault')}
        />
      </div>
      <SectionHead title={t('settingsTitle')} body={t('settingsBody')} />
      <ConsolidationSettings t={t} />
      <div className="bb-grid bb-gridTwo">
        <InfoCard title={t('settingsLocalTitle')} body={t('settingsLocalBody')} badge={t('planned')} />
        <InfoCard title={t('settingsMirrorTitle')} body={t('settingsMirrorBody')} badge={t('planned')} />
      </div>
    </section>
  )
}

/**
 * Consolidation model picker.
 *
 * Leaving it empty keeps the heuristic extractor, so the control is honest
 * about being optional rather than a required setup step.
 */
function ConsolidationSettings({ t }: { t: TranslateBaibao }) {
  const [models, setModels] = useState<ModelChoice[]>([])
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'saved' | 'error'>('loading')

  useEffect(() => {
    let live = true
    void getConfig().then((result) => {
      if (!live) return
      if (result.ok) {
        setModels(result.models)
        setProvider(result.consolidation.provider ?? '')
        setModel(result.consolidation.model ?? '')
        setStatus('ready')
      } else {
        setStatus('error')
      }
    })
    return () => {
      live = false
    }
  }, [])

  const save = async (nextProvider: string, nextModel: string): Promise<void> => {
    setStatus('saving')
    const result = await saveConsolidationModel(
      nextProvider === '' ? null : nextProvider,
      nextModel === '' ? null : nextModel,
    )
    if (result.ok) {
      setModels(result.models)
      setStatus('saved')
    } else {
      setStatus('error')
    }
  }

  const choices = models.filter((item) => provider === '' || item.provider === provider)
  const providers = [...new Map(models.map((item) => [item.provider, item])).values()]

  return (
    <div className="bb-consolidation">
      <div className="bb-jungRowTop">
        <span className="bb-jungBlockTitle">{t('consolidationTitle')}</span>
      </div>
      <p className="bb-storageHint">{t('consolidationBody')}</p>
      <div className="bb-consolidationRow">
        <label className="bb-consolidationLabel" htmlFor="bb-consolidation-provider">
          {t('consolidationProvider')}
        </label>
        <select
          id="bb-consolidation-provider"
          className="bb-consolidationSelect"
          value={provider}
          disabled={status === 'loading' || status === 'saving'}
          onChange={(event) => {
            const next = event.target.value
            setProvider(next)
            setModel('')
            setStatus('ready')
          }}
        >
          <option value="">{t('consolidationOff')}</option>
          {providers.map((item) => (
            <option key={item.provider} value={item.provider}>
              {item.providerName}
            </option>
          ))}
        </select>
      </div>
      <div className="bb-consolidationRow">
        <label className="bb-consolidationLabel" htmlFor="bb-consolidation-model">
          {t('consolidationModel')}
        </label>
        <select
          id="bb-consolidation-model"
          className="bb-consolidationSelect"
          value={model}
          disabled={provider === '' || status === 'loading' || status === 'saving'}
          onChange={(event) => {
            setModel(event.target.value)
            setStatus('ready')
          }}
        >
          <option value="">{t('consolidationPickModel')}</option>
          {choices.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
      <div className="bb-personaActions">
        <button
          type="button"
          className="bb-personaBtn"
          onClick={() => void save(provider, model)}
          disabled={status === 'loading' || status === 'saving'}
        >
          {t('consolidationSave')}
        </button>
      </div>
      {status === 'saved' && (
        <p className="bb-storageOk" role="status">
          {t('consolidationSaved')}
        </p>
      )}
      {status === 'error' && (
        <p className="bb-storageError" role="alert">
          {t('consolidationFailed')}
        </p>
      )}
    </div>
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

function InfoCard({ title, body, badge }: { title: string; body: string; badge: string }) {
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
