import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BarChart3, BriefcaseBusiness, Gauge, Inbox, LayoutDashboard, Settings as SettingsIcon } from 'lucide-react'
import { Analytics } from './components/Analytics'
import { ApplicationDrawer } from './components/ApplicationDrawer'
import { Applications } from './components/Applications'
import { Onboarding } from './components/Onboarding'
import { Overview } from './components/Overview'
import { Settings } from './components/Settings'
import { GmailReview } from './components/GmailReview'
import type { ApplicationEntry, AppSettings } from './domain/types'
import { createGmailApiClient, type GmailApiClient } from './gmail/api'
import { createGmailAuthClient, type GmailAuthClient } from './gmail/auth'
import { useGmailImport } from './hooks/useGmailImport'
import { trackerRepository, type TrackerRepository } from './storage/repository'

interface AppProps {
  repository?: TrackerRepository
  gmailAuth?: GmailAuthClient
  gmailApiFactory?: (getAccessToken: () => string | null) => GmailApiClient
}
type Page = 'overview' | 'applications' | 'review' | 'analytics' | 'settings'
interface ToastState { message: string; undoEntry?: ApplicationEntry }

const defaultGmailAuth = createGmailAuthClient(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '')
const defaultGmailApiFactory = (getAccessToken: () => string | null) => createGmailApiClient(getAccessToken)

export function App({
  repository = trackerRepository,
  gmailAuth = defaultGmailAuth,
  gmailApiFactory = defaultGmailApiFactory,
}: AppProps) {
  const [entries, setEntries] = useState<ApplicationEntry[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [page, setPage] = useState<Page>('overview')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerEntry, setDrawerEntry] = useState<ApplicationEntry | undefined>()
  const [toast, setToast] = useState<ToastState | null>(null)
  const [fatalError, setFatalError] = useState('')

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
    setToast({
      message: gmailResult.newCandidates > 0
        ? `${gmailResult.newCandidates} Gmail ${gmailResult.newCandidates === 1 ? 'match is' : 'matches are'} ready to review`
        : 'Gmail is up to date',
    })
    clearGmailResult()
  }, [gmailResult, clearGmailResult])

  async function saveSettings(next: AppSettings) {
    await repository.saveSettings(next)
    setSettings(next)
  }

  async function saveEntry(entry: ApplicationEntry) {
    await repository.saveEntry(entry)
    await load()
    setToast({ message: drawerEntry ? 'Application updated' : 'Application added' })
  }

  async function deleteEntry(entry: ApplicationEntry) {
    await repository.deleteEntry(entry.id)
    setDrawerOpen(false)
    setDrawerEntry(undefined)
    await load()
    setToast({ message: 'Application deleted', undoEntry: entry })
  }

  async function undoDelete() {
    if (!toast?.undoEntry) return
    await repository.saveEntry(toast.undoEntry)
    setToast(null)
    await load()
  }

  async function restore(raw: string) {
    await repository.restoreFromJson(raw)
    await Promise.all([load(), gmail.refresh()])
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

  if (fatalError) return <main className="fatal-state"><AlertTriangle /><h1>Local data could not be opened</h1><p>{fatalError}</p><button className="button primary" onClick={() => window.location.reload()}>Reload Paceboard</button></main>
  if (!settings) return <main className="loading-state"><span className="brand-mark">P</span><p>Opening your paceboard…</p></main>
  if (settings.weeklyTarget === 0) return <Onboarding onSave={(weeklyTarget) => saveSettings({ ...settings, weeklyTarget })} />

  const needsBackup = entries.length > 0 && (!settings.lastBackupAt || Date.now() - new Date(settings.lastBackupAt).getTime() > 14 * 86_400_000)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">P</span><span>Paceboard</span></div>
        <nav aria-label="Primary navigation">
          <NavButton label="Overview" active={page === 'overview'} icon={<LayoutDashboard size={19} />} onClick={() => setPage('overview')} />
          <NavButton label="Applications" active={page === 'applications'} icon={<BriefcaseBusiness size={19} />} onClick={() => setPage('applications')} />
          <NavButton label="Review" count={gmail.pendingCandidates.length} active={page === 'review'} icon={<Inbox size={19} />} onClick={() => setPage('review')} />
          <NavButton label="Analytics" active={page === 'analytics'} icon={<BarChart3 size={19} />} onClick={() => setPage('analytics')} />
          <NavButton label="Settings & data" active={page === 'settings'} icon={<SettingsIcon size={19} />} onClick={() => setPage('settings')} />
        </nav>
        <div className="sidebar-note"><Gauge size={18} /><p><strong>Every role counts.</strong><span>Keep the history useful.</span></p></div>
        <p className="local-note">Private · Stored in this browser</p>
      </aside>

      <main className="main-area">
        {needsBackup && page !== 'settings' && <button type="button" className="backup-warning" onClick={() => setPage('settings')}><AlertTriangle size={16} /><span>Your local data needs a backup.</span><strong>Back up now</strong></button>}
        {page === 'overview' && <Overview entries={entries} settings={settings} onAdd={addApplication} onEdit={editApplication} onOpenApplications={() => setPage('applications')} />}
        {page === 'applications' && <Applications entries={entries} sources={settings.sources} onAdd={addApplication} onEdit={editApplication} />}
        {page === 'review' && <GmailReview candidates={gmail.pendingCandidates} entries={entries} onAccept={gmail.acceptCandidate} onDismiss={gmail.dismissCandidate} />}
        {page === 'analytics' && <Analytics entries={entries} />}
        {page === 'settings' && <Settings entries={entries} settings={settings} gmail={gmail} onSave={saveSettings} onRestore={restore} />}
      </main>

      {drawerOpen && <ApplicationDrawer key={drawerEntry?.id ?? 'new'} entry={drawerEntry} sources={settings.sources} onClose={closeDrawer} onSave={saveEntry} onDelete={deleteEntry} />}
      {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.undoEntry && <button type="button" onClick={undoDelete}>Undo</button>}<button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
    </div>
  )
}

function NavButton({ label, count, active, icon, onClick }: { label: string; count?: number; active: boolean; icon: React.ReactNode; onClick: () => void }) {
  const accessibleLabel = count === undefined ? label : `${label}, ${count} pending`
  return <button type="button" className={active ? 'active' : ''} onClick={onClick} aria-label={accessibleLabel}>{icon}<span>{label}</span>{count !== undefined && <span className="nav-count" aria-hidden="true">{count}</span>}</button>
}
