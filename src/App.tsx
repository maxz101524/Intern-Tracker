import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, Bot, BriefcaseBusiness, ChevronRight, CircleCheck, Inbox, LayoutDashboard, Mail, Plus, Search, Settings as SettingsIcon } from 'lucide-react'
import { Analytics } from './components/Analytics'
import { ApplicationDrawer } from './components/ApplicationDrawer'
import { Applications, type ApplicationViewCommand } from './components/Applications'
import { GmailReview } from './components/GmailReview'
import { MuseReview } from './components/MuseReview'
import { Onboarding } from './components/Onboarding'
import { Overview } from './components/Overview'
import { Settings } from './components/Settings'
import { CommandMenu } from './components/CommandMenu'
import { getWeekSummary } from './domain/analytics'
import { buildBackup } from './domain/backup'
import type { RestoreChoices } from './domain/restore'
import { DEFAULT_RESUME_VARIANTS } from './domain/settings'
import type { ApplicationEntry, ApplicationFilterState, AppSettings, GmailCandidate } from './domain/types'
import { createGmailApiClient, type GmailApiClient } from './gmail/api'
import { createGmailAuthClient, type GmailAuthClient } from './gmail/auth'
import { useGmailImport, type GmailReviewInput, type GmailStatusReviewInput } from './hooks/useGmailImport'
import { useMuseSync } from './hooks/useMuseSync'
import { createMuseRelayClient, type MuseRelayClient } from './muse/client'
import { getMuseKey } from './muse/keyStore'
import { trackerRepository, type TrackerRepository } from './storage/repository'
import { downloadText } from './utils/download'

interface AppProps {
  repository?: TrackerRepository
  gmailAuth?: GmailAuthClient
  gmailApiFactory?: (getAccessToken: () => string | null) => GmailApiClient
  museClient?: MuseRelayClient
  musePollIntervalMs?: number
}
type Page = 'overview' | 'applications' | 'review' | 'analytics' | 'settings'
interface ToastState { message: string; undoEntries?: ApplicationEntry[] }

const defaultGmailAuth = createGmailAuthClient(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
const defaultGmailApiFactory = (getAccessToken: () => string | null) => createGmailApiClient(getAccessToken)
const defaultMuseClient = createMuseRelayClient({ getKey: getMuseKey })

export function App({ repository = trackerRepository, gmailAuth = defaultGmailAuth, gmailApiFactory = defaultGmailApiFactory, museClient = defaultMuseClient, musePollIntervalMs }: AppProps) {
  const [entries, setEntries] = useState<ApplicationEntry[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [applicationViewCommand, setApplicationViewCommand] = useState<ApplicationViewCommand>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [drawerEntry, setDrawerEntry] = useState<ApplicationEntry | undefined>()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [fatalError, setFatalError] = useState('')
  const [reviewSource, setReviewSource] = useState<'gmail' | 'muse'>('gmail')
  const scrollPositions = useRef<Record<Page, number>>({ overview: 0, applications: 0, review: 0, analytics: 0, settings: 0 })
  const commandId = useRef(0)

  const load = useCallback(async () => {
    try {
      const [nextEntries, nextSettings] = await Promise.all([repository.listEntries(), repository.getSettings()])
      setEntries(nextEntries)
      setSettings(nextSettings)
    } catch (caught) {
      setFatalError(caught instanceof Error ? caught.message : 'Paceboard could not open its local data.')
    }
  }, [repository])

  const gmail = useGmailImport(repository, gmailAuth, gmailApiFactory, load)
  const { lastResult: gmailResult, clearLastResult: clearGmailResult } = gmail
  const muse = useMuseSync({ repository, client: museClient, entries, settings, onEntriesChanged: load, pollIntervalMs: musePollIntervalMs })
  const { lastResult: museResult, clearLastResult: clearMuseResult } = muse
  const museWaiting = muse.pendingItems.length + muse.openDecisions.length

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!gmailResult) return
    const matches = gmailResult.newCandidates > 0
      ? `${gmailResult.newCandidates} Gmail ${gmailResult.newCandidates === 1 ? 'match is' : 'matches are'} ready to review`
      : gmailResult.skippedMessages > 0 ? 'Gmail synced' : 'Gmail is up to date'
    const skipped = gmailResult.skippedMessages > 0
      ? `; ${gmailResult.skippedMessages} unavailable ${gmailResult.skippedMessages === 1 ? 'message' : 'messages'} skipped`
      : ''
    setToast({ message: `${matches}${skipped}` })
    clearGmailResult()
  }, [gmailResult, clearGmailResult])
  useEffect(() => {
    if (!museResult) return
    const message = describeMusePull(museResult.summary, museResult.newDecisions)
    if (message) setToast({ message })
    clearMuseResult()
  }, [museResult, clearMuseResult])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (drawerOpen || event.isComposing) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setSearchOpen((current) => !current); return
      }
      if (searchOpen || event.metaKey || event.ctrlKey || event.altKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === '/' && page !== 'applications') { event.preventDefault(); setSearchOpen(true); return }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); addApplication() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [drawerOpen, searchOpen, page])

  function navigate(next: Page) {
    scrollPositions.current[page] = window.scrollY
    // Choose the review source on arrival so resolving the last item doesn't switch views underneath you.
    if (next === 'review' && page !== 'review') {
      setReviewSource(gmail.pendingCandidates.length === 0 && museWaiting > 0 ? 'muse' : 'gmail')
    }
    setPage(next)
    requestAnimationFrame(() => {
      document.documentElement.scrollTop = scrollPositions.current[next]
      document.body.scrollTop = scrollPositions.current[next]
    })
  }

  function openApplications(filters?: Partial<ApplicationFilterState>) {
    if (filters) {
      commandId.current += 1
      setApplicationViewCommand({ id: commandId.current, filters })
    }
    navigate('applications')
  }

  async function saveSettings(next: AppSettings) {
    await repository.saveSettings(next)
    await load()
  }

  async function markBackup(exportedAt: string) {
    const next = await repository.markBackup(exportedAt)
    setSettings(next)
  }

  async function saveEntry(entry: ApplicationEntry) {
    await repository.saveEntry(entry)
    await load()
    setToast({ message: drawerEntry ? 'Application updated' : 'Application added' })
  }

  async function updateEntries(next: ApplicationEntry[], previous: ApplicationEntry[], message: string) {
    await repository.saveEntries(next)
    await load()
    setToast({ message, undoEntries: previous })
  }

  async function deleteEntry(entry: ApplicationEntry) {
    await repository.deleteEntry(entry.id)
    setDrawerOpen(false)
    setDrawerEntry(undefined)
    await load()
    setToast({ message: 'Application deleted', undoEntries: [entry] })
  }

  async function undoChange() {
    if (!toast?.undoEntries) return
    await repository.saveEntries(toast.undoEntries)
    setToast(null)
    await load()
  }

  async function restore(raw: string, mode: 'merge' | 'replace', choices?: RestoreChoices) {
    await repository.restoreFromJson(raw, mode, choices)
    await Promise.all([load(), gmail.refresh(), muse.refresh()])
  }

  async function acceptGmailCandidate(candidate: GmailCandidate, input: GmailReviewInput) {
    await gmail.acceptCandidate(candidate, input)
    setToast({ message: 'Application added from Gmail' })
  }

  async function acceptGmailStatus(candidate: GmailCandidate, input: GmailStatusReviewInput) {
    await gmail.acceptStatusCandidate(candidate, input)
    setToast({ message: `${input.status === 'rejected' ? 'Rejection' : 'Status'} added from Gmail` })
  }

  function addApplication() {
    setDrawerEntry(undefined)
    setDrawerOpen(true)
  }

  function editApplication(entry: ApplicationEntry) {
    setDrawerEntry(entry)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setDrawerEntry(undefined)
  }

  async function downloadBackupNow() {
    if (!settings) return
    const exportedAt = new Date().toISOString()
    const backupSettings = { ...settings, lastBackupAt: exportedAt, lastBackupChangeCount: settings.changeCount ?? 0 }
    downloadText(`paceboard-backup-${exportedAt.slice(0, 10)}.json`, JSON.stringify(buildBackup(entries, backupSettings, gmail.gmailData, exportedAt, muse.data), null, 2), 'application/json')
    await markBackup(exportedAt)
    setToast({ message: 'Full backup downloaded' })
  }

  if (fatalError) return <main className="fatal-state"><AlertTriangle /><h1>Local data could not be opened</h1><p>{fatalError}</p><button className="button primary" onClick={() => window.location.reload()}>Reload Paceboard</button></main>
  if (!settings) return <main className="loading-state"><span className="brand-mark">P</span><p>Opening your paceboard…</p></main>
  if (settings.weeklyTarget === 0) return <Onboarding onSave={(weeklyTarget) => saveSettings({ ...settings, weeklyTarget })} />

  const changesSinceBackup = Math.max(0, (settings.changeCount ?? 0) - (settings.lastBackupChangeCount ?? 0))
  // Muse writes many small changes a day, so nudge weekly instead of after every sync.
  const backupAgeDays = settings.lastBackupAt ? (Date.now() - new Date(settings.lastBackupAt).getTime()) / 86_400_000 : Infinity
  const needsBackup = entries.length > 0 && (!settings.lastBackupAt || (changesSinceBackup > 0 && backupAgeDays > 7))
  const backupWarning = !settings.lastBackupAt
    ? 'Your applications live only in this browser. Download a backup to keep a copy.'
    : `${changesSinceBackup} ${changesSinceBackup === 1 ? 'change' : 'changes'} since your last backup ${Math.floor(backupAgeDays)} days ago.`
  const week = getWeekSummary(entries, settings.weeklyTarget, new Date(), settings.applicationDays)
  const reviewCount = gmail.pendingCandidates.length + museWaiting
  const reviewSwitcher = <div className="source-switch" role="group" aria-label="Review source">
    <button type="button" aria-pressed={reviewSource === 'gmail'} onClick={() => setReviewSource('gmail')}><Mail size={15} /> Gmail <span>{gmail.pendingCandidates.length}</span></button>
    <button type="button" aria-pressed={reviewSource === 'muse'} onClick={() => setReviewSource('muse')}><Bot size={15} /> Muse <span>{museWaiting}</span></button>
  </div>
  const pageLabels: Record<Page, string> = { overview: 'Overview', applications: 'Applications', review: 'Review', analytics: 'Analytics', settings: 'Settings & data' }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace-content">Skip to content</a>
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28" fill="none"><path d="M7 20V8h7a5 5 0 0 1 0 10H7M11 20v-8h3a1 1 0 0 1 0 2h-3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg></span><span>Paceboard<span className="brand-caption">Your job search workspace</span></span></div>
        <nav aria-label="Primary navigation">
          <NavButton label="Overview" active={page === 'overview'} icon={<LayoutDashboard size={19} />} onClick={() => navigate('overview')} />
          <NavButton label="Applications" active={page === 'applications'} icon={<BriefcaseBusiness size={19} />} onClick={() => navigate('applications')} />
          <NavButton label="Review" count={reviewCount} active={page === 'review'} icon={<Inbox size={19} />} onClick={() => navigate('review')} />
          <NavButton label="Analytics" active={page === 'analytics'} icon={<BarChart3 size={19} />} onClick={() => navigate('analytics')} />
          <NavButton label="Settings & data" active={page === 'settings'} icon={<SettingsIcon size={19} />} onClick={() => navigate('settings')} />
        </nav>
        <button type="button" className="sidebar-pace" onClick={() => navigate('overview')} aria-label="Open weekly pace"><span>This week <strong>{week.submitted}<small> / {settings.weeklyTarget}</small></strong></span><span className="sidebar-progress"><i style={{ width: `${Math.min(100, week.submitted / settings.weeklyTarget * 100)}%` }} /></span><small>{week.remaining ? `${week.remaining} applications to your goal` : 'Weekly goal reached'}</small></button>
        {muse.connected
          ? <button type="button" className={`sidebar-meta sidebar-sync ${muse.status === 'error' ? 'is-error' : ''}`} onClick={() => navigate('settings')} aria-label="Open Muse sync settings"><Bot size={16} /><div><span>{muse.status === 'error' ? 'Muse sync paused' : muse.status === 'syncing' ? 'Syncing with Muse…' : 'Muse connected'}</span><small>{muse.status === 'error' ? 'Open settings to fix' : lastPullLabel(muse.data.syncState.lastPulledAt)}</small></div></button>
          : <div className="sidebar-meta"><CircleCheck size={16} /><div><span>Local workspace</span><small>Saved in this browser</small></div></div>}
      </aside>

      <main className="main-area" id="workspace-content" tabIndex={-1}>
        <div className="workspace-bar"><div className="workspace-breadcrumb"><span>My workspace</span><ChevronRight size={14} /><strong>{pageLabels[page]}</strong></div><button type="button" className="workspace-search" onClick={() => setSearchOpen(true)} aria-label="Search workspace"><Search size={16} /><span>Find anything</span><kbd>⌘ K</kbd></button><time className="workspace-date" dateTime={new Date().toLocaleDateString('en-CA')}>{new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}</time></div>
        {needsBackup && page !== 'settings' && <button type="button" className="backup-warning" onClick={() => void downloadBackupNow().catch(() => setToast({ message: 'Backup could not be downloaded. Try again from Settings & data.' }))}><AlertTriangle size={15} /><span>{backupWarning}</span><strong>Download backup <ChevronRight size={14} /></strong></button>}
        {page === 'overview' && <Overview entries={entries} settings={settings} reviewCount={reviewCount} onOpenReview={() => navigate('review')} onAdd={addApplication} onEdit={editApplication} onUpdateEntry={(next, previous, message) => updateEntries([next], [previous], message)} onOpenApplications={openApplications} />}
        <div hidden={page !== 'applications'}><Applications entries={entries} settings={settings} viewCommand={applicationViewCommand} onAdd={addApplication} onEdit={editApplication} onUpdateEntries={updateEntries} onSaveSettings={saveSettings} /></div>
        {page === 'review' && (reviewSource === 'muse'
          ? <MuseReview muse={muse} entries={entries} switcher={reviewSwitcher} />
          : <GmailReview candidates={gmail.pendingCandidates} dismissedCandidates={gmail.dismissedCandidates} entries={entries} onAccept={acceptGmailCandidate} onLink={gmail.linkCandidate} onAcceptStatus={acceptGmailStatus} onDismiss={gmail.dismissCandidate} onRestore={gmail.restoreCandidate} switcher={reviewSwitcher} />)}
        {page === 'analytics' && <Analytics entries={entries} onOpenApplications={openApplications} />}
        {page === 'settings' && <Settings entries={entries} settings={settings} gmail={gmail} muse={muse} onSave={saveSettings} onMarkBackup={markBackup} onRestore={restore} />}
      </main>

      {searchOpen && <CommandMenu entries={entries} actions={[
        { id: 'add', label: 'Add application', detail: 'Log a new role', icon: <Plus size={19} />, run: addApplication },
        { id: 'applications', label: 'Applications', detail: 'Search and manage your roles', icon: <BriefcaseBusiness size={19} />, run: () => openApplications({}) },
        { id: 'review', label: 'Review updates', detail: `${reviewCount} waiting from Gmail and Muse`, icon: <Inbox size={19} />, run: () => navigate('review') },
        { id: 'analytics', label: 'Analytics', detail: 'Explore your application patterns', icon: <BarChart3 size={19} />, run: () => navigate('analytics') },
        { id: 'settings', label: 'Settings & data', detail: 'Preferences, Gmail, and backups', icon: <SettingsIcon size={19} />, run: () => navigate('settings') },
      ]} onEdit={editApplication} onSearchApplications={(query) => openApplications({ query })} onClose={() => setSearchOpen(false)} />}
      {drawerOpen && <ApplicationDrawer key={drawerEntry?.id ?? 'new'} entry={drawerEntry} entries={entries} sources={settings.sources} resumeVariants={settings.resumeVariants ?? DEFAULT_RESUME_VARIANTS} onClose={closeDrawer} onSave={saveEntry} onDelete={deleteEntry} onOpenExisting={editApplication} />}
      {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.undoEntries && <button type="button" onClick={undoChange}>Undo</button>}<button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
    </div>
  )
}

function lastPullLabel(lastPulledAt?: string): string {
  if (!lastPulledAt) return 'Waiting for first pull'
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(lastPulledAt)) / 60_000))
  if (minutes < 1) return 'Checked just now'
  if (minutes < 60) return `Checked ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `Checked ${hours} h ago` : `Checked ${new Date(lastPulledAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

function describeMusePull(summary: { created: number; filled: number; statuses: number; review: number }, questions = 0): string {
  const parts = [
    summary.created && `${summary.created} ${summary.created === 1 ? 'role' : 'roles'} added`,
    summary.statuses && `${summary.statuses} status ${summary.statuses === 1 ? 'update' : 'updates'}`,
    summary.filled && `${summary.filled} ${summary.filled === 1 ? 'role' : 'roles'} filled in`,
  ].filter(Boolean)
  const waiting = summary.review + questions
  const review = waiting ? `${waiting} ${waiting === 1 ? 'needs' : 'need'} you` : ''
  if (!parts.length && !review) return ''
  return `Muse: ${[parts.join(', '), review].filter(Boolean).join(' · ')}`
}

function NavButton({ label, count, active, icon, onClick }: { label: string; count?: number; active: boolean; icon: React.ReactNode; onClick: () => void }) {
  const accessibleLabel = count === undefined ? label : `${label}, ${count} pending`
  return <button type="button" className={active ? 'active' : ''} onClick={onClick} aria-current={active ? 'page' : undefined} aria-label={accessibleLabel}>{icon}<span className="nav-label">{label}</span>{count !== undefined && count > 0 && <span className="nav-count" aria-hidden="true">{count}</span>}</button>
}
