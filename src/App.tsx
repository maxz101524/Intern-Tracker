import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BarChart3, BriefcaseBusiness, Gauge, Inbox, LayoutDashboard, Settings as SettingsIcon } from 'lucide-react'
import { Analytics } from './components/Analytics'
import { ApplicationDrawer } from './components/ApplicationDrawer'
import { Applications, type ApplicationViewCommand } from './components/Applications'
import { GmailReview } from './components/GmailReview'
import { Onboarding } from './components/Onboarding'
import { Overview } from './components/Overview'
import { Settings } from './components/Settings'
import { buildBackup } from './domain/backup'
import type { RestoreChoices } from './domain/restore'
import { DEFAULT_RESUME_VARIANTS } from './domain/settings'
import type { ApplicationEntry, ApplicationFilterState, AppSettings, GmailCandidate } from './domain/types'
import { createGmailApiClient, type GmailApiClient } from './gmail/api'
import { createGmailAuthClient, type GmailAuthClient } from './gmail/auth'
import { useGmailImport, type GmailReviewInput, type GmailStatusReviewInput } from './hooks/useGmailImport'
import { trackerRepository, type TrackerRepository } from './storage/repository'
import { downloadText } from './utils/download'

interface AppProps {
  repository?: TrackerRepository
  gmailAuth?: GmailAuthClient
  gmailApiFactory?: (getAccessToken: () => string | null) => GmailApiClient
}
type Page = 'overview' | 'applications' | 'review' | 'analytics' | 'settings'
interface ToastState { message: string; undoEntries?: ApplicationEntry[] }

const defaultGmailAuth = createGmailAuthClient(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
const defaultGmailApiFactory = (getAccessToken: () => string | null) => createGmailApiClient(getAccessToken)

export function App({ repository = trackerRepository, gmailAuth = defaultGmailAuth, gmailApiFactory = defaultGmailApiFactory }: AppProps) {
  const [entries, setEntries] = useState<ApplicationEntry[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [applicationViewCommand, setApplicationViewCommand] = useState<ApplicationViewCommand>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerEntry, setDrawerEntry] = useState<ApplicationEntry | undefined>()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [fatalError, setFatalError] = useState('')
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

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!gmailResult) return
    setToast({ message: gmailResult.newCandidates > 0 ? `${gmailResult.newCandidates} Gmail ${gmailResult.newCandidates === 1 ? 'match is' : 'matches are'} ready to review` : 'Gmail is up to date' })
    clearGmailResult()
  }, [gmailResult, clearGmailResult])
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (drawerOpen || event.metaKey || event.ctrlKey || event.altKey || target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); addApplication() }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [drawerOpen])

  function navigate(next: Page) {
    scrollPositions.current[page] = window.scrollY
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
    await Promise.all([load(), gmail.refresh()])
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
    downloadText(`paceboard-backup-${exportedAt.slice(0, 10)}.json`, JSON.stringify(buildBackup(entries, backupSettings, gmail.gmailData, exportedAt), null, 2), 'application/json')
    await markBackup(exportedAt)
    setToast({ message: 'Full backup downloaded' })
  }

  if (fatalError) return <main className="fatal-state"><AlertTriangle /><h1>Local data could not be opened</h1><p>{fatalError}</p><button className="button primary" onClick={() => window.location.reload()}>Reload Paceboard</button></main>
  if (!settings) return <main className="loading-state"><span className="brand-mark">P</span><p>Opening your paceboard…</p></main>
  if (settings.weeklyTarget === 0) return <Onboarding onSave={(weeklyTarget) => saveSettings({ ...settings, weeklyTarget })} />

  const changesSinceBackup = Math.max(0, (settings.changeCount ?? 0) - (settings.lastBackupChangeCount ?? 0))
  const needsBackup = entries.length > 0 && (changesSinceBackup > 0 || !settings.lastBackupAt || Date.now() - new Date(settings.lastBackupAt).getTime() > 14 * 86_400_000)
  const backupWarning = !settings.lastBackupAt
    ? 'No full backup has been downloaded.'
    : changesSinceBackup > 0
      ? `${changesSinceBackup} ${changesSinceBackup === 1 ? 'change' : 'changes'} since your last backup.`
      : 'Your last backup is over 14 days old.'

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">P</span><span>Paceboard</span></div>
        <nav aria-label="Primary navigation">
          <NavButton label="Overview" active={page === 'overview'} icon={<LayoutDashboard size={19} />} onClick={() => navigate('overview')} />
          <NavButton label="Applications" active={page === 'applications'} icon={<BriefcaseBusiness size={19} />} onClick={() => navigate('applications')} />
          <NavButton label="Review" count={gmail.pendingCandidates.length} active={page === 'review'} icon={<Inbox size={19} />} onClick={() => navigate('review')} />
          <NavButton label="Analytics" active={page === 'analytics'} icon={<BarChart3 size={19} />} onClick={() => navigate('analytics')} />
          <NavButton label="Settings & data" active={page === 'settings'} icon={<SettingsIcon size={19} />} onClick={() => navigate('settings')} />
        </nav>
        <div className="sidebar-note"><Gauge size={18} /><p><strong>Every role counts.</strong><span>Keep the history useful.</span></p></div>
        <p className="local-note">Private · Stored in this browser</p>
      </aside>

      <main className="main-area">
        {needsBackup && page !== 'settings' && <button type="button" className="backup-warning" onClick={() => void downloadBackupNow()}><AlertTriangle size={16} /><span>{backupWarning}</span><strong>Download backup</strong></button>}
        {page === 'overview' && <Overview entries={entries} settings={settings} onAdd={addApplication} onEdit={editApplication} onUpdateEntry={(next, previous, message) => updateEntries([next], [previous], message)} onOpenApplications={openApplications} />}
        <div hidden={page !== 'applications'}><Applications entries={entries} settings={settings} viewCommand={applicationViewCommand} onAdd={addApplication} onEdit={editApplication} onUpdateEntries={updateEntries} onSaveSettings={saveSettings} /></div>
        {page === 'review' && <GmailReview candidates={gmail.pendingCandidates} dismissedCandidates={gmail.dismissedCandidates} entries={entries} onAccept={acceptGmailCandidate} onLink={gmail.linkCandidate} onAcceptStatus={acceptGmailStatus} onDismiss={gmail.dismissCandidate} onRestore={gmail.restoreCandidate} />}
        {page === 'analytics' && <Analytics entries={entries} onOpenApplications={openApplications} />}
        {page === 'settings' && <Settings entries={entries} settings={settings} gmail={gmail} onSave={saveSettings} onMarkBackup={markBackup} onRestore={restore} />}
      </main>

      {drawerOpen && <ApplicationDrawer key={drawerEntry?.id ?? 'new'} entry={drawerEntry} entries={entries} sources={settings.sources} resumeVariants={settings.resumeVariants ?? DEFAULT_RESUME_VARIANTS} onClose={closeDrawer} onSave={saveEntry} onDelete={deleteEntry} onOpenExisting={editApplication} />}
      {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.undoEntries && <button type="button" onClick={undoChange}>Undo</button>}<button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
    </div>
  )
}

function NavButton({ label, count, active, icon, onClick }: { label: string; count?: number; active: boolean; icon: React.ReactNode; onClick: () => void }) {
  const accessibleLabel = count === undefined ? label : `${label}, ${count} pending`
  return <button type="button" className={active ? 'active' : ''} onClick={onClick} aria-label={accessibleLabel}>{icon}<span>{label}</span>{count !== undefined && <span className="nav-count" aria-hidden="true">{count}</span>}</button>
}
