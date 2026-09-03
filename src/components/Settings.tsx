import { useState, type ChangeEvent, type FormEvent } from 'react'
import { AlertTriangle, Database, Download, FileSpreadsheet, Plus, Upload, X } from 'lucide-react'
import { buildBackup, entriesToCsv, parseBackup } from '../domain/backup'
import type { ApplicationEntry, AppSettings, TrackerBackup } from '../domain/types'

interface SettingsProps {
  entries: ApplicationEntry[]
  settings: AppSettings
  onSave: (settings: AppSettings) => Promise<void>
  onRestore: (raw: string) => Promise<void>
}

export function Settings({ entries, settings, onSave, onRestore }: SettingsProps) {
  const [target, setTarget] = useState(String(settings.weeklyTarget))
  const [sources, setSources] = useState(settings.sources)
  const [newSource, setNewSource] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [restore, setRestore] = useState<{ raw: string; backup: TrackerBackup } | null>(null)

  async function savePreferences(event: FormEvent) {
    event.preventDefault()
    const weeklyTarget = Number(target)
    if (!Number.isInteger(weeklyTarget) || weeklyTarget < 1 || weeklyTarget > 500) {
      setError('Weekly target must be a whole number between 1 and 500.')
      return
    }
    await onSave({ ...settings, weeklyTarget, sources })
    setMessage('Preferences saved')
    setError('')
  }

  function addSource() {
    const value = newSource.trim()
    if (!value || sources.some((source) => source.toLowerCase() === value.toLowerCase())) return
    setSources([...sources, value])
    setNewSource('')
  }

  async function exportJson() {
    const exportedAt = new Date().toISOString()
    const nextSettings = { ...settings, lastBackupAt: exportedAt }
    const backup = buildBackup(entries, nextSettings, exportedAt)
    downloadText(
      `paceboard-backup-${exportedAt.slice(0, 10)}.json`,
      JSON.stringify(backup, null, 2),
      'application/json',
    )
    await onSave(nextSettings)
    setMessage('Full backup downloaded')
  }

  function exportCsv() {
    downloadText(
      `paceboard-applications-${new Date().toISOString().slice(0, 10)}.csv`,
      `\uFEFF${entriesToCsv(entries)}`,
      'text/csv;charset=utf-8',
    )
    setMessage('CSV downloaded')
  }

  async function chooseRestore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const raw = await file.text()
      setRestore({ raw, backup: parseBackup(raw) })
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The backup could not be read.')
    }
  }

  async function confirmRestore() {
    if (!restore) return
    await onRestore(restore.raw)
    setRestore(null)
    setMessage('Backup restored')
  }

  const totalInRestore = restore?.backup.entries.reduce((sum, entry) => sum + entry.quantity, 0) ?? 0

  return (
    <div className="page-content settings-page">
      <header className="page-header"><div><p className="context-label">Make it yours</p><h1>Settings & data</h1></div></header>

      {message && <div className="settings-message" role="status">{message}</div>}
      {error && <p className="form-error settings-error" role="alert">{error}</p>}

      <div className="settings-layout">
        <form className="settings-section" onSubmit={savePreferences}>
          <div className="settings-heading"><span className="settings-icon"><Database size={20} /></span><div><h2>Tracking preferences</h2><p>Set the pace and sources that fit your search.</p></div></div>
          <label className="setting-field">Weekly target<input type="number" min="1" max="500" value={target} onChange={(event) => setTarget(event.target.value)} /></label>
          <div className="setting-field">
            <span>Application sources</span>
            <div className="source-list">
              {sources.map((source) => (
                <span key={source}>{source}<button type="button" onClick={() => setSources(sources.filter((item) => item !== source))} aria-label={`Remove ${source}`}><X size={14} /></button></span>
              ))}
            </div>
            <div className="add-source"><input value={newSource} onChange={(event) => setNewSource(event.target.value)} placeholder="Add another source" /><button type="button" className="button secondary" onClick={addSource}><Plus size={16} /> Add</button></div>
          </div>
          <button className="button primary align-start">Save preferences</button>
        </form>

        <section className="settings-section">
          <div className="settings-heading"><span className="settings-icon"><Download size={20} /></span><div><h2>Own your data</h2><p>Back up the full app or open your ledger in a spreadsheet.</p></div></div>
          <div className="data-action">
            <div><strong>Full JSON backup</strong><span>Includes every entry and setting. Use this to restore Paceboard.</span></div>
            <button type="button" className="button secondary" onClick={exportJson}><Download size={17} /> Download backup</button>
          </div>
          <div className="data-action">
            <div><strong>Spreadsheet export</strong><span>One row per ledger entry, including aggregate quantities.</span></div>
            <button type="button" className="button secondary" onClick={exportCsv}><FileSpreadsheet size={17} /> Export CSV</button>
          </div>
          <div className="data-action">
            <div><strong>Restore from backup</strong><span>Validate a JSON backup before replacing this browser’s data.</span></div>
            <label className="button secondary file-button"><Upload size={17} /> Choose backup<input type="file" accept="application/json,.json" onChange={chooseRestore} /></label>
          </div>
          <p className="backup-date">Last full backup: {settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString() : 'Never'}</p>
        </section>
      </div>

      {restore && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="restore-title">
            <span className="warning-icon"><AlertTriangle /></span>
            <h2 id="restore-title">Replace current data?</h2>
            <p>The backup contains <strong>{totalInRestore} applications</strong> across {restore.backup.entries.length} ledger entries. Restoring replaces this browser’s current entries and settings.</p>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setRestore(null)}>Cancel</button><button type="button" className="button danger" onClick={confirmRestore}>Replace and restore</button></div>
          </section>
        </div>
      )}
    </div>
  )
}

function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
