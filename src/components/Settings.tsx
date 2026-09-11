import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { AlertTriangle, Database, Download, FileSpreadsheet, Plus, Upload, X } from 'lucide-react'
import { buildBackup, entriesToCsv, parseBackup } from '../domain/backup'
import { findRestoreConflicts, type RestoreChoices } from '../domain/restore'
import { DEFAULT_APPLICATION_DAYS, DEFAULT_RESUME_VARIANTS } from '../domain/settings'
import type { ApplicationEntry, AppSettings, TrackerBackup } from '../domain/types'
import type { GmailImportController } from '../hooks/useGmailImport'
import { downloadText } from '../utils/download'
import { GmailSettings } from './GmailSettings'

interface SettingsProps {
  entries: ApplicationEntry[]
  settings: AppSettings
  gmail: GmailImportController
  onSave: (settings: AppSettings) => Promise<void>
  onMarkBackup: (exportedAt: string) => Promise<void>
  onRestore: (raw: string, mode: 'merge' | 'replace', choices?: RestoreChoices) => Promise<void>
}

const days = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' },
]

export function Settings({ entries, settings, gmail, onSave, onMarkBackup, onRestore }: SettingsProps) {
  const [target, setTarget] = useState(String(settings.weeklyTarget))
  const [sources, setSources] = useState(settings.sources)
  const [newSource, setNewSource] = useState('')
  const [resumeVariants, setResumeVariants] = useState(settings.resumeVariants ?? DEFAULT_RESUME_VARIANTS)
  const [newResumeVariant, setNewResumeVariant] = useState('')
  const [applicationDays, setApplicationDays] = useState(settings.applicationDays ?? DEFAULT_APPLICATION_DAYS)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [restore, setRestore] = useState<{ raw: string; backup: TrackerBackup } | null>(null)
  const [restoreChoices, setRestoreChoices] = useState<RestoreChoices>({})
  const conflicts = useMemo(() => restore ? findRestoreConflicts(entries, restore.backup.entries) : [], [entries, restore])
  const changeCount = Math.max(0, (settings.changeCount ?? 0) - (settings.lastBackupChangeCount ?? 0))

  async function savePreferences(event: FormEvent) {
    event.preventDefault()
    const weeklyTarget = Number(target)
    if (!Number.isInteger(weeklyTarget) || weeklyTarget < 1 || weeklyTarget > 500) {
      setError('Weekly target must be a whole number between 1 and 500.')
      return
    }
    if (!applicationDays.length) {
      setError('Choose at least one application day.')
      return
    }
    await onSave({ ...settings, weeklyTarget, sources, resumeVariants, applicationDays })
    setMessage('Preferences saved')
    setError('')
  }

  function addValue(value: string, values: string[], setValues: (next: string[]) => void, reset: () => void) {
    const clean = value.trim()
    if (!clean || values.some((item) => item.toLowerCase() === clean.toLowerCase())) return
    setValues([...values, clean]); reset()
  }

  async function exportJson() {
    const exportedAt = new Date().toISOString()
    const nextSettings = { ...settings, lastBackupAt: exportedAt, lastBackupChangeCount: settings.changeCount ?? 0 }
    const backup = buildBackup(entries, nextSettings, gmail.gmailData, exportedAt)
    downloadText(`paceboard-backup-${exportedAt.slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json')
    await onMarkBackup(exportedAt)
    setMessage('Full backup downloaded')
  }

  function exportCsv() {
    downloadText(`paceboard-applications-${new Date().toISOString().slice(0, 10)}.csv`, `\uFEFF${entriesToCsv(entries)}`, 'text/csv;charset=utf-8')
    setMessage('CSV downloaded')
  }

  async function chooseRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const raw = await file.text()
      const backup = parseBackup(raw)
      setRestore({ raw, backup })
      setRestoreChoices(Object.fromEntries(findRestoreConflicts(entries, backup.entries).map(({ backup }) => [backup.id, 'current'])))
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The backup could not be read.')
    }
  }

  async function confirmRestore(mode: 'merge' | 'replace') {
    if (!restore) return
    await onRestore(restore.raw, mode, restoreChoices)
    setRestore(null)
    setMessage(mode === 'merge' ? 'Backup merged' : 'Backup replaced current data')
  }

  const totalInRestore = restore?.backup.entries.length ?? 0
  const pendingInRestore = restore?.backup.gmail.candidates.filter((candidate) => candidate.state === 'pending').length ?? 0

  return (
    <div className="page-content settings-page">
      <header className="page-header"><div><p className="context-label">Make it yours</p><h1>Settings & data</h1></div></header>
      {message && <div className="settings-message" role="status">{message}</div>}
      {error && <p className="form-error settings-error" role="alert">{error}</p>}

      <div className="settings-layout">
        <GmailSettings gmail={gmail} />
        <form className="settings-section" onSubmit={savePreferences}>
          <div className="settings-heading"><span className="settings-icon"><Database size={20} /></span><div><h2>Tracking preferences</h2><p>Set the pace and vocabulary that fit your search.</p></div></div>
          <label className="setting-field">Weekly target<input type="number" min="1" max="500" value={target} onChange={(event) => setTarget(event.target.value)} /></label>
          <fieldset className="setting-field day-picker"><legend>Application days</legend><div>{days.map((day) => <label key={day.value} className={applicationDays.includes(day.value) ? 'selected' : ''}><input type="checkbox" checked={applicationDays.includes(day.value)} onChange={(event) => setApplicationDays(event.target.checked ? [...applicationDays, day.value] : applicationDays.filter((value) => value !== day.value))} />{day.label}</label>)}</div></fieldset>
          <ListSetting label="Application sources" values={sources} onRemove={(value) => setSources(sources.filter((item) => item !== value))} inputValue={newSource} onInput={setNewSource} placeholder="Add another source" onAdd={() => addValue(newSource, sources, setSources, () => setNewSource(''))} />
          <ListSetting label="Resume variants" values={resumeVariants} onRemove={(value) => setResumeVariants(resumeVariants.filter((item) => item !== value))} inputValue={newResumeVariant} onInput={setNewResumeVariant} placeholder="Add a resume variant" onAdd={() => addValue(newResumeVariant, resumeVariants, setResumeVariants, () => setNewResumeVariant(''))} />
          <button className="button primary align-start">Save preferences</button>
        </form>

        <section className="settings-section">
          <div className="settings-heading"><span className="settings-icon"><Download size={20} /></span><div><h2>Own your data</h2><p>{changeCount} {changeCount === 1 ? 'change' : 'changes'} since the last backup.</p></div></div>
          <div className="data-action"><div><strong>Full JSON backup</strong><span>Includes applications, actions, review items, status events, views, and settings.</span></div><button type="button" className="button secondary" onClick={exportJson}><Download size={17} /> Download backup</button></div>
          <div className="data-action"><div><strong>Spreadsheet export</strong><span>One row per role, including action and status history.</span></div><button type="button" className="button secondary" onClick={exportCsv}><FileSpreadsheet size={17} /> Export CSV</button></div>
          <div className="data-action"><div><strong>Restore from backup</strong><span>Preview a backup, then merge it or replace this browser’s data.</span></div><label className="button secondary file-button"><Upload size={17} /> Choose backup<input type="file" accept="application/json,.json" onChange={chooseRestore} /></label></div>
          <p className="backup-date">Last full backup: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString() : 'Never'}</p>
        </section>
      </div>

      {restore && <div className="modal-backdrop" role="presentation"><section className="confirm-modal restore-preview" role="dialog" aria-modal="true" aria-labelledby="restore-title"><span className="warning-icon"><AlertTriangle /></span><h2 id="restore-title">Restore preview</h2><p>The backup contains <strong>{totalInRestore} applications</strong> and <strong>{pendingInRestore} pending Gmail matches</strong>. Merge keeps current settings and adds non-conflicting records; Replace uses the backup exactly.</p>{conflicts.length > 0 && <div className="restore-conflicts"><h3>{conflicts.length} conflicting {conflicts.length === 1 ? 'record' : 'records'}</h3>{conflicts.map((conflict) => <label key={conflict.backup.id}><span><strong>{conflict.current.company} — {conflict.current.title}</strong><small>Current updated {new Date(conflict.current.updatedAt).toLocaleDateString()} · backup updated {new Date(conflict.backup.updatedAt).toLocaleDateString()}</small></span><select value={restoreChoices[conflict.backup.id] ?? 'current'} onChange={(event) => setRestoreChoices((choices) => ({ ...choices, [conflict.backup.id]: event.target.value as 'current' | 'backup' }))}><option value="current">Keep current</option><option value="backup">Use backup</option></select></label>)}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setRestore(null)}>Cancel</button><button type="button" className="button secondary" onClick={() => void confirmRestore('merge')}>Merge</button><button type="button" className="button danger" onClick={() => void confirmRestore('replace')}>Replace</button></div></section></div>}
    </div>
  )
}

function ListSetting({ label, values, onRemove, inputValue, onInput, placeholder, onAdd }: { label: string; values: string[]; onRemove: (value: string) => void; inputValue: string; onInput: (value: string) => void; placeholder: string; onAdd: () => void }) {
  return <div className="setting-field"><span>{label}</span><div className="source-list">{values.map((value) => <span key={value}>{value}<button type="button" onClick={() => onRemove(value)} aria-label={`Remove ${value}`}><X size={14} /></button></span>)}</div><div className="add-source"><input aria-label={`New ${label.toLowerCase()}`} value={inputValue} onChange={(event) => onInput(event.target.value)} placeholder={placeholder} /><button type="button" className="button secondary" onClick={onAdd}><Plus size={16} /> Add</button></div></div>
}
