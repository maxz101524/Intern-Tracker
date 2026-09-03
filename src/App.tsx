import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Gauge, History as HistoryIcon, LayoutDashboard, Settings as SettingsIcon } from 'lucide-react'
import { createEntry } from './domain/entries'
import type { ApplicationEntry, AppSettings, EntryDetails, EntryInput } from './domain/types'
import { Dashboard } from './components/Dashboard'
import { EntryDrawer } from './components/EntryDrawer'
import { History } from './components/History'
import { Onboarding } from './components/Onboarding'
import { Settings } from './components/Settings'
import { trackerRepository, type TrackerRepository } from './storage/repository'

interface AppProps {
  repository?: TrackerRepository
}

type Page = 'dashboard' | 'history' | 'settings'

interface ToastState {
  message: string
  undoEntry?: ApplicationEntry
}

export function App({ repository = trackerRepository }: AppProps) {
  const [entries, setEntries] = useState<ApplicationEntry[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  const [selectedEntry, setSelectedEntry] = useState<ApplicationEntry | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [fatalError, setFatalError] = useState('')

  const load = useCallback(async () => {
    try {
      const [nextEntries, nextSettings] = await Promise.all([
        repository.listEntries(),
        repository.getSettings(),
      ])
      setEntries(nextEntries)
      setSettings(nextSettings)
    } catch (caught) {
      setFatalError(caught instanceof Error ? caught.message : 'Paceboard could not open its local data.')
    }
  }, [repository])

  useEffect(() => { void load() }, [load])

  async function saveSettings(next: AppSettings) {
    await repository.saveSettings(next)
    setSettings(next)
  }

  async function logEntry(input: EntryInput) {
    await repository.saveEntry(createEntry(input))
    await load()
    setToast({ message: 'Application logged' })
  }

  async function saveEntry(entry: ApplicationEntry) {
    await repository.saveEntry(createEntry(entry))
    await load()
    setToast({ message: 'Entry updated' })
  }

  async function deleteEntry(entry: ApplicationEntry) {
    await repository.deleteEntry(entry.id)
    setSelectedEntry(null)
    await load()
    setToast({ message: 'Entry deleted', undoEntry: entry })
  }

  async function undoDelete() {
    if (!toast?.undoEntry) return
    await repository.saveEntry(toast.undoEntry)
    setToast(null)
    await load()
  }

  async function splitEntry(entry: ApplicationEntry, details: EntryDetails) {
    await repository.splitBatch(entry.id, details)
    await load()
    setToast({ message: 'Application split from batch' })
  }

  async function restore(raw: string) {
    await repository.restoreFromJson(raw)
    await load()
  }

  if (fatalError) {
    return <main className="fatal-state"><AlertTriangle /><h1>Local data could not be opened</h1><p>{fatalError}</p><button className="button primary" onClick={() => window.location.reload()}>Reload Paceboard</button></main>
  }

  if (!settings) return <main className="loading-state"><span className="brand-mark">P</span><p>Opening your paceboard…</p></main>

  if (settings.weeklyTarget === 0) {
    return <Onboarding onSave={(weeklyTarget) => saveSettings({ ...settings, weeklyTarget })} />
  }

  const needsBackup = entries.length > 0 && (!settings.lastBackupAt || Date.now() - new Date(settings.lastBackupAt).getTime() > 14 * 86_400_000)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true">P</span><span>Paceboard</span></div>
        <nav aria-label="Primary navigation">
          <NavButton label="Dashboard" active={page === 'dashboard'} icon={<LayoutDashboard size={19} />} onClick={() => setPage('dashboard')} />
          <NavButton label="History" active={page === 'history'} icon={<HistoryIcon size={19} />} onClick={() => setPage('history')} />
          <NavButton label="Settings & data" active={page === 'settings'} icon={<SettingsIcon size={19} />} onClick={() => setPage('settings')} />
        </nav>
        <div className="sidebar-note"><Gauge size={18} /><p><strong>Count everything.</strong><span>Curate almost nothing.</span></p></div>
        <p className="local-note">Private · Stored in this browser</p>
      </aside>

      <main className="main-area">
        {needsBackup && page !== 'settings' && (
          <button type="button" className="backup-warning" onClick={() => setPage('settings')}><AlertTriangle size={17} /><span>Your local data needs a backup.</span><strong>Back up now</strong></button>
        )}
        {page === 'dashboard' && <Dashboard entries={entries} settings={settings} onLog={logEntry} onEdit={setSelectedEntry} onOpenHistory={() => setPage('history')} />}
        {page === 'history' && <History entries={entries} sources={settings.sources} onEdit={setSelectedEntry} />}
        {page === 'settings' && <Settings entries={entries} settings={settings} onSave={saveSettings} onRestore={restore} />}
      </main>

      {selectedEntry && <EntryDrawer entry={selectedEntry} sources={settings.sources} onClose={() => setSelectedEntry(null)} onSave={saveEntry} onDelete={deleteEntry} onSplit={splitEntry} />}
      {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.undoEntry && <button type="button" onClick={undoDelete}>Undo</button>}<button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
    </div>
  )
}

function NavButton({ label, active, icon, onClick }: { label: string; active: boolean; icon: React.ReactNode; onClick: () => void }) {
  return <button type="button" className={active ? 'active' : ''} onClick={onClick} aria-label={label}>{icon}<span>{label}</span></button>
}
