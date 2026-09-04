import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ExternalLink, History, Trash2, X } from 'lucide-react'
import { createApplication } from '../domain/entries'
import { APPLICATION_STATUSES, appendStatus, getCurrentStatus, getDisplayStatus, statusLabel, todayDate } from '../domain/status'
import type { ApplicationEffort, ApplicationEntry, ApplicationStatus } from '../domain/types'
import { StatusBadge } from './StatusBadge'

interface ApplicationDrawerProps {
  entry?: ApplicationEntry
  sources: string[]
  onClose: () => void
  onSave: (entry: ApplicationEntry) => Promise<void>
  onDelete?: (entry: ApplicationEntry) => Promise<void>
}

export function ApplicationDrawer({ entry, sources, onClose, onSave, onDelete }: ApplicationDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null)
  const companyRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const [company, setCompany] = useState(entry?.company ?? '')
  const [title, setTitle] = useState(entry?.title ?? '')
  const [submittedDate, setSubmittedDate] = useState(entry?.submittedDate ?? todayDate())
  const [effort, setEffort] = useState<ApplicationEffort>(entry?.effort ?? 'quick')
  const [source, setSource] = useState(entry?.source ?? '')
  const [url, setUrl] = useState(entry?.url ?? '')
  const [resumeVariant, setResumeVariant] = useState(entry?.resumeVariant ?? '')
  const [notes, setNotes] = useState(entry?.notes ?? '')
  const storedStatus = entry ? getCurrentStatus(entry) : 'applied'
  const [status, setStatus] = useState<ApplicationStatus>(storedStatus)
  const [statusDate, setStatusDate] = useState(todayDate())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)

  useLayoutEffect(() => {
    companyRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const returnFocus = returnFocusRef.current
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => !element.closest('details:not([open])'))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      returnFocus?.focus()
    }
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    await save(false)
  }

  async function save(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      const statusHistory = entry?.statusHistory.map((event, index) => index === 0 ? { ...event, date: submittedDate } : event)
      let next = createApplication({
        id: entry?.id,
        company,
        title,
        submittedDate,
        effort,
        source: source || undefined,
        url: url || undefined,
        resumeVariant: resumeVariant || undefined,
        notes: notes || undefined,
        statusHistory,
        updatedAt: new Date().toISOString(),
      })
      if (status !== getCurrentStatus(next)) next = appendStatus(next, status, statusDate)
      await onSave(next)

      if (addAnother) {
        setCompany('')
        setTitle('')
        setUrl('')
        setResumeVariant('')
        setNotes('')
        setStatus('applied')
        setStatusDate(todayDate())
        setFocusRequest((request) => request + 1)
      } else {
        onClose()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The application could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const displayStatus = entry ? getDisplayStatus(entry) : 'applied'

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={drawerRef} className="application-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div><p className="context-label">{entry ? 'Application details' : 'One role at a time'}</p><h2 id="drawer-title">{entry ? `${entry.company} — ${entry.title}` : 'Add application'}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close application drawer"><X /></button>
        </header>

        {entry && <div className="drawer-current-status"><span>Current status</span><StatusBadge status={displayStatus} /></div>}

        <form className="drawer-form" onSubmit={submit}>
          <div className="two-fields">
            <label>Company<input ref={companyRef} required value={company} onChange={(event) => setCompany(event.target.value)} autoComplete="organization" /></label>
            <label>Role title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          </div>
          <div className="two-fields">
            <label>Submitted<input required type="date" value={submittedDate} onChange={(event) => setSubmittedDate(event.target.value)} /></label>
            <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Not specified</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>

          <fieldset className="effort-fieldset"><legend>Application effort</legend><div className="effort-control"><label className={effort === 'quick' ? 'selected' : ''}><input type="radio" name="effort" value="quick" checked={effort === 'quick'} onChange={() => setEffort('quick')} /><span><strong>Quick</strong><small>Standard online application</small></span></label><label className={effort === 'targeted' ? 'selected' : ''}><input type="radio" name="effort" value="targeted" checked={effort === 'targeted'} onChange={() => setEffort('targeted')} /><span><strong>Targeted</strong><small>Referral, event, or tailored materials</small></span></label></div></fieldset>

          <div className="two-fields status-update-fields">
            <label>Current status<select value={status} onChange={(event) => setStatus(event.target.value as ApplicationStatus)}>{APPLICATION_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
            {status !== storedStatus && <label>Status date<input type="date" value={statusDate} min={submittedDate} onChange={(event) => setStatusDate(event.target.value)} /></label>}
          </div>
          {entry && displayStatus === 'no_response' && status === 'applied' && <p className="inline-note">Paceboard shows No response because this application has stayed at Applied for 21 days. Choose a new status whenever an update arrives.</p>}

          <details className="optional-details">
            <summary><ChevronDown size={16} /> Resume, link, and notes</summary>
            <div>
              <label>Job URL<div className="input-with-icon"><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />{url && <a href={url} target="_blank" rel="noreferrer" aria-label="Open job listing"><ExternalLink size={16} /></a>}</div></label>
              <label>Resume version<select value={resumeVariant} onChange={(event) => setResumeVariant(event.target.value)}><option value="">Not specified</option><option>ML</option><option>DS</option><option>Hybrid</option><option>Tailored</option></select></label>
              <label>Notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Contacts, follow-up context, or anything useful later." /></label>
            </div>
          </details>

          {entry && <section className="status-timeline" aria-labelledby="status-history-title"><div><History size={16} /><h3 id="status-history-title">Status history</h3></div><ol>{entry.statusHistory.map((event) => <li key={event.id}><span /><strong>{statusLabel(event.status)}</strong><time dateTime={event.date}>{event.date}</time></li>)}</ol></section>}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="drawer-actions">
            {entry && onDelete && <button type="button" className="button danger-text" onClick={() => onDelete(entry)}><Trash2 size={16} /> Delete application</button>}
            <span className="drawer-action-spacer" />
            {!entry && <button type="button" className="button secondary" disabled={saving} onClick={() => save(true)}>Save & add another</button>}
            <button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : entry ? 'Save changes' : 'Save application'}</button>
          </div>
        </form>
      </aside>
    </div>
  )
}
