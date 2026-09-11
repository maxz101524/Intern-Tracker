import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, History, Trash2, X } from 'lucide-react'
import { createApplication } from '../domain/entries'
import { findPossibleDuplicate } from '../domain/gmail'
import { APPLICATION_STATUSES, appendStatus, getCurrentStatus, getDisplayStatus, statusLabel, todayDate } from '../domain/status'
import type { ApplicationEffort, ApplicationEntry, ApplicationStatus, StatusEvent } from '../domain/types'
import { StatusBadge } from './StatusBadge'

interface ApplicationDrawerProps {
  entry?: ApplicationEntry
  entries: ApplicationEntry[]
  sources: string[]
  resumeVariants: string[]
  onClose: () => void
  onSave: (entry: ApplicationEntry) => Promise<void>
  onDelete?: (entry: ApplicationEntry) => Promise<void>
  onOpenExisting?: (entry: ApplicationEntry) => void
}

interface Draft {
  company: string
  title: string
  submittedDate: string
  effort: ApplicationEffort
  source: string
  url: string
  resumeVariant: string
  notes: string
  nextAction: string
  nextActionDueDate: string
  nextActionCompleted: boolean
  jobDescriptionExcerpt: string
  history: StatusEvent[]
  status: ApplicationStatus
  statusDate: string
}

const actionSuggestions = ['Complete assessment', 'Prepare for interview', 'Follow up']

export function ApplicationDrawer({
  entry,
  entries,
  sources,
  resumeVariants,
  onClose,
  onSave,
  onDelete,
  onOpenExisting,
}: ApplicationDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const companyRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const draftKey = `paceboard-application-draft:${entry?.id ?? 'new'}`
  const [draft, setDraft] = useState<Draft>(() => readDraft(draftKey) ?? initialDraft(entry))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)

  useLayoutEffect(() => { companyRef.current?.focus() }, [focusRequest])
  useEffect(() => { localStorage.setItem(draftKey, JSON.stringify(draft)) }, [draft, draftKey])

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
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        formRef.current?.requestSubmit()
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

  const duplicate = useMemo(() => {
    if (entry || !draft.company.trim() || !draft.title.trim()) return null
    const match = findPossibleDuplicate({ company: draft.company, title: draft.title, submittedDate: draft.submittedDate }, entries)
    return match ? { ...match, entry: entries.find((item) => item.id === match.entryId) } : null
  }, [draft.company, draft.submittedDate, draft.title, entries, entry])

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await save(false)
  }

  async function save(addAnother: boolean) {
    setSaving(true)
    setError('')
    try {
      const history = draft.history.map((event, index) => index === 0 ? { ...event, date: draft.submittedDate } : event)
      let next = createApplication({
        id: entry?.id,
        company: draft.company,
        title: draft.title,
        submittedDate: draft.submittedDate,
        effort: draft.effort,
        source: draft.source || undefined,
        url: draft.url || undefined,
        resumeVariant: draft.resumeVariant || undefined,
        notes: draft.notes || undefined,
        nextAction: draft.nextAction || undefined,
        nextActionDueDate: draft.nextAction ? draft.nextActionDueDate || undefined : undefined,
        nextActionCompleted: draft.nextAction ? draft.nextActionCompleted : undefined,
        nextActionCompletedAt: draft.nextActionCompleted ? entry?.nextActionCompletedAt : undefined,
        jobDescriptionExcerpt: draft.jobDescriptionExcerpt || undefined,
        origin: entry?.origin,
        statusHistory: history.length ? history : undefined,
        updatedAt: new Date().toISOString(),
      })
      if (draft.status !== getCurrentStatus(next)) next = appendStatus(next, draft.status, draft.statusDate)
      await onSave(next)
      localStorage.removeItem(draftKey)

      if (addAnother) {
        setDraft({ ...initialDraft(), submittedDate: draft.submittedDate, source: draft.source })
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

  function updateHistory(id: string, patch: Partial<StatusEvent>) {
    setDraft((current) => {
      const history = current.history.map((event) => event.id === id ? { ...event, ...patch } : event)
      return { ...current, history, status: history.at(-1)?.status ?? 'applied' }
    })
  }

  function removeHistory(id: string) {
    setDraft((current) => {
      const history = current.history.filter((event) => event.id !== id)
      return { ...current, history, status: history.at(-1)?.status ?? 'applied' }
    })
  }

  const displayStatus = entry ? getDisplayStatus(entry) : 'applied'

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={drawerRef} className="application-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div><p className="context-label">{entry ? 'Application details' : 'One role at a time'}</p><h2 id="drawer-title">{entry ? `${entry.company} — ${entry.title}` : 'Add application'}</h2><small className="shortcut-hint">Save with <kbd>⌘</kbd><kbd>↵</kbd></small></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close application drawer"><X /></button>
        </header>

        {entry && <div className="drawer-current-status"><span>Current status</span><StatusBadge status={displayStatus} /></div>}

        <form ref={formRef} className="drawer-form" onSubmit={submit}>
          <div className="two-fields">
            <label>Company<input ref={companyRef} required value={draft.company} onChange={(event) => patchDraft({ company: event.target.value })} autoComplete="organization" /></label>
            <label>Role title<input required value={draft.title} onChange={(event) => patchDraft({ title: event.target.value })} /></label>
          </div>
          {duplicate?.entry && <div className="duplicate-warning" role="status"><AlertTriangle size={17} /><span><strong>Possible duplicate:</strong> {duplicate.entry.company} — {duplicate.entry.title}, submitted {duplicate.entry.submittedDate}.</span>{onOpenExisting && <button type="button" className="text-button" onClick={() => onOpenExisting(duplicate.entry!)}>Open existing</button>}</div>}
          <div className="two-fields">
            <label>Submitted<input required type="date" value={draft.submittedDate} onChange={(event) => patchDraft({ submittedDate: event.target.value })} /></label>
            <label>Source<select value={draft.source} onChange={(event) => patchDraft({ source: event.target.value })}><option value="">Not specified</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>

          <fieldset className="effort-fieldset"><legend>Application effort</legend><div className="effort-control"><label className={draft.effort === 'quick' ? 'selected' : ''}><input type="radio" name="effort" value="quick" checked={draft.effort === 'quick'} onChange={() => patchDraft({ effort: 'quick' })} /><span><strong>Quick</strong><small>Standard online application</small></span></label><label className={draft.effort === 'targeted' ? 'selected' : ''}><input type="radio" name="effort" value="targeted" checked={draft.effort === 'targeted'} onChange={() => patchDraft({ effort: 'targeted' })} /><span><strong>Targeted</strong><small>Referral, event, or tailored materials</small></span></label></div></fieldset>

          <div className="two-fields status-update-fields">
            <label>Current status<select value={draft.status} onChange={(event) => patchDraft({ status: event.target.value as ApplicationStatus })}>{APPLICATION_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
            {draft.status !== (draft.history.at(-1)?.status ?? 'applied') && <label>Status date<input type="date" value={draft.statusDate} min={draft.submittedDate} onChange={(event) => patchDraft({ statusDate: event.target.value })} /></label>}
          </div>
          {entry && displayStatus === 'no_response' && draft.status === 'applied' && <p className="inline-note">Paceboard shows No response after 21 days at Applied. Choose a new status when an update arrives.</p>}

          <section className="next-action-fields" aria-labelledby="next-action-title">
            <div className="section-heading compact-heading"><div><h3 id="next-action-title">Next action</h3><p>Optional work that should return to Overview.</p></div></div>
            <div className="two-fields">
              <label>Action<input list="next-action-suggestions" value={draft.nextAction} onChange={(event) => patchDraft({ nextAction: event.target.value, nextActionCompleted: false })} placeholder="Follow up" /><datalist id="next-action-suggestions">{actionSuggestions.map((action) => <option key={action} value={action} />)}</datalist></label>
              <label>Due date<input type="date" value={draft.nextActionDueDate} onChange={(event) => patchDraft({ nextActionDueDate: event.target.value })} disabled={!draft.nextAction} /></label>
            </div>
            {draft.nextAction && <label className="check-field"><input type="checkbox" checked={draft.nextActionCompleted} onChange={(event) => patchDraft({ nextActionCompleted: event.target.checked })} /> Mark this action complete</label>}
          </section>

          <details className="optional-details">
            <summary><ChevronDown size={16} /> Resume, listing, and notes</summary>
            <div>
              <label>Job URL<div className="input-with-icon"><input type="url" value={draft.url} onChange={(event) => patchDraft({ url: event.target.value })} placeholder="https://" />{draft.url && <a href={draft.url} target="_blank" rel="noreferrer" aria-label="Open job listing"><ExternalLink size={16} /></a>}</div></label>
              <label>Resume variant<select value={draft.resumeVariant} onChange={(event) => patchDraft({ resumeVariant: event.target.value })}><option value="">Not specified</option>{resumeVariants.map((variant) => <option key={variant}>{variant}</option>)}</select></label>
              <label>Job-description excerpt<textarea rows={3} value={draft.jobDescriptionExcerpt} onChange={(event) => patchDraft({ jobDescriptionExcerpt: event.target.value })} placeholder="Keep the essentials if the listing expires." /></label>
              <label>Notes<textarea rows={4} value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} placeholder="Contacts, follow-up context, or anything useful later." /></label>
            </div>
          </details>

          {entry && <section className="status-timeline" aria-labelledby="status-history-title"><div><History size={16} /><h3 id="status-history-title">Status history</h3></div><p>Correct a date or outcome here. Applied stays tied to the submission date.</p><ol>{draft.history.map((event, index) => <li key={event.id}><span /><select aria-label={`Status event ${index + 1}`} value={event.status} disabled={index === 0} onChange={(change) => updateHistory(event.id, { status: change.target.value as ApplicationStatus })}>{APPLICATION_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select><input aria-label={`Status event ${index + 1} date`} type="date" value={event.date} disabled={index === 0} min={draft.submittedDate} onChange={(change) => updateHistory(event.id, { date: change.target.value })} />{index > 0 && <button type="button" className="icon-button" onClick={() => removeHistory(event.id)} aria-label={`Remove ${statusLabel(event.status)} event`}><Trash2 size={15} /></button>}</li>)}</ol></section>}
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

function initialDraft(entry?: ApplicationEntry): Draft {
  return {
    company: entry?.company ?? '',
    title: entry?.title ?? '',
    submittedDate: entry?.submittedDate ?? todayDate(),
    effort: entry?.effort ?? 'quick',
    source: entry?.source ?? '',
    url: entry?.url ?? '',
    resumeVariant: entry?.resumeVariant ?? '',
    notes: entry?.notes ?? '',
    nextAction: entry?.nextAction ?? '',
    nextActionDueDate: entry?.nextActionDueDate ?? '',
    nextActionCompleted: entry?.nextActionCompleted ?? false,
    jobDescriptionExcerpt: entry?.jobDescriptionExcerpt ?? '',
    history: entry?.statusHistory.map((event) => ({ ...event })) ?? [],
    status: entry ? getCurrentStatus(entry) : 'applied',
    statusDate: todayDate(),
  }
}

function readDraft(key: string): Draft | null {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) as Draft : null
  } catch {
    return null
  }
}
