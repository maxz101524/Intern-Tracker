import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, Check, ChevronDown, ExternalLink, History, RotateCcw, Trash2, X } from 'lucide-react'
import { createApplication } from '../domain/entries'
import { formatShortDate } from '../domain/analytics'
import { findPossibleDuplicate } from '../domain/gmail'
import { APPLICATION_STATUSES, appendStatus, getCurrentStatus, getDisplayStatus, isApplicationStatus, statusLabel, todayDate } from '../domain/status'
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
  const initialDraftRef = useRef(initialDraft(entry))
  const [restoredDraft, setRestoredDraft] = useState<Draft | null>(() => readDraft(draftKey))
  const [draft, setDraft] = useState<Draft>(() => restoredDraft ?? initialDraftRef.current)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const operationRef = useRef<'saving' | 'deleting' | null>(null)
  const [draftStorageAvailable, setDraftStorageAvailable] = useState(true)
  const [error, setError] = useState('')
  const [focusRequest, setFocusRequest] = useState(0)
  const busy = saving || deleting
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(initialDraftRef.current)

  useLayoutEffect(() => { companyRef.current?.focus() }, [focusRequest])
  useEffect(() => {
    try {
      if (JSON.stringify(draft) === JSON.stringify(initialDraftRef.current)) localStorage.removeItem(draftKey)
      else localStorage.setItem(draftKey, JSON.stringify(draft))
      setDraftStorageAvailable(true)
    } catch {
      setDraftStorageAvailable(false)
    }
  }, [draft, draftKey])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const returnFocus = returnFocusRef.current
    document.body.style.overflow = 'hidden'
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!operationRef.current) onCloseRef.current()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (!operationRef.current) formRef.current?.requestSubmit()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]',
      ) ?? [])].filter(isFocusable)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !drawerRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !drawerRef.current?.contains(document.activeElement))) {
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
    if (operationRef.current) return
    setDraft((current) => ({ ...current, ...patch }))
    setRestoredDraft(null)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    await save(false)
  }

  async function save(addAnother: boolean) {
    if (operationRef.current) return
    const form = formRef.current
    if (!form) return
    // Open optional fields before reporting invalid values so the browser can focus them.
    for (const field of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')) {
      if (!field.validity.valid) {
        const details = field.closest('details')
        if (details) details.open = true
      }
    }
    if (!form.reportValidity()) return
    operationRef.current = 'saving'
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
        postedDate: entry?.postedDate,
        statusHistory: history.length ? history : undefined,
        updatedAt: new Date().toISOString(),
      })
      if (draft.status !== getCurrentStatus(next)) next = appendStatus(next, draft.status, draft.statusDate)
      await onSave(next)
      removeSavedDraft()

      if (addAnother) {
        const nextDraft = { ...initialDraft(), submittedDate: draft.submittedDate, source: draft.source }
        initialDraftRef.current = nextDraft
        setDraft(nextDraft)
        setRestoredDraft(null)
        setFocusRequest((request) => request + 1)
      } else {
        onClose()
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The application could not be saved.')
    } finally {
      operationRef.current = null
      setSaving(false)
    }
  }

  function removeSavedDraft() {
    try {
      localStorage.removeItem(draftKey)
    } catch {
      setDraftStorageAvailable(false)
    }
  }

  function discardDraft() {
    if (operationRef.current) return
    setDraft(initialDraftRef.current)
    setRestoredDraft(null)
    setError('')
    removeSavedDraft()
    setFocusRequest((request) => request + 1)
  }

  async function deleteApplication() {
    if (!entry || !onDelete || operationRef.current) return
    operationRef.current = 'deleting'
    setDeleting(true)
    setError('')
    try {
      await onDelete(entry)
      removeSavedDraft()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The application could not be deleted.')
    } finally {
      operationRef.current = null
      setDeleting(false)
    }
  }

  function updateHistory(id: string, patch: Partial<StatusEvent>) {
    if (operationRef.current) return
    setDraft((current) => {
      const [applied, ...updates] = current.history.map((event) => event.id === id ? { ...event, ...patch } : event)
      const history = applied ? [applied, ...updates.sort((a, b) => a.date.localeCompare(b.date))] : []
      return { ...current, history, status: history.at(-1)?.status ?? 'applied' }
    })
    setRestoredDraft(null)
    setError('')
  }

  function removeHistory(id: string) {
    if (operationRef.current) return
    setDraft((current) => {
      const history = current.history.filter((event) => event.id !== id)
      return { ...current, history, status: history.at(-1)?.status ?? 'applied' }
    })
    setRestoredDraft(null)
    setError('')
  }

  const displayStatus = entry ? getDisplayStatus(entry) : 'applied'

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <aside ref={drawerRef} className="application-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-busy={busy}>
        <header className="drawer-header">
          <div><p className="context-label">{entry ? 'Application details' : 'One role at a time'}</p><h2 id="drawer-title">{entry ? `${entry.company} — ${entry.title}` : 'Add application'}</h2><small className="shortcut-hint">Save with <kbd>⌘</kbd><kbd>↵</kbd></small></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close application drawer"><X /></button>
        </header>

        {entry && <div className="drawer-current-status drawer-glance" aria-label="Application summary">
          <div><StatusBadge status={displayStatus} /><span>{[`Submitted ${formatShortDate(entry.submittedDate)}`, postedLabel(entry), entry.source, entry.resumeVariant && `${entry.resumeVariant} resume`].filter(Boolean).join(' · ')}</span>{entry.url && <a href={entry.url} target="_blank" rel="noreferrer">Open posting <ExternalLink size={13} /></a>}</div>
          {entry.notes && <p>{entry.notes.split('\n')[0]}</p>}
        </div>}

        <form ref={formRef} className="drawer-form" onSubmit={submit} noValidate>
          <div className="drawer-form-content">
            <div className="drawer-draft-status">
              <p role="status">{draftStorageAvailable ? <Check size={14} /> : <AlertTriangle size={14} />}{!draftStorageAvailable ? 'Draft storage is unavailable. Keep this form open until you save.' : hasUnsavedChanges ? restoredDraft ? 'Your unsaved draft was restored.' : 'Draft saved on this device.' : 'Your draft stays on this device as you type.'}</p>
              {hasUnsavedChanges && <button type="button" className="text-button" onClick={discardDraft} disabled={busy}><RotateCcw size={14} /> Discard draft</button>}
            </div>
            <p className="inline-note" id="application-required-hint">Company, role title, and submitted date are required. Everything else is optional.</p>
            <fieldset className="drawer-fields" disabled={busy} aria-describedby="application-required-hint">
              <div className="two-fields">
                <label>Company<input ref={companyRef} required value={draft.company} onChange={(event) => patchDraft({ company: event.target.value })} autoComplete="organization" /></label>
                <label>Role title<input required value={draft.title} onChange={(event) => patchDraft({ title: event.target.value })} /></label>
              </div>
              {duplicate?.entry && <div className="duplicate-warning" role="status"><AlertTriangle size={17} /><span><strong>Possible duplicate:</strong> {duplicate.entry.company} — {duplicate.entry.title}, submitted {duplicate.entry.submittedDate}.</span>{onOpenExisting && <button type="button" className="text-button" onClick={() => onOpenExisting(duplicate.entry!)}>Open existing</button>}</div>}
              <div className="two-fields">
                <label>Submitted<input required type="date" value={draft.submittedDate} onChange={(event) => patchDraft({ submittedDate: event.target.value, history: draft.history.map((statusEvent, index) => index === 0 ? { ...statusEvent, date: event.target.value } : statusEvent) })} /></label>
                <label>Source<select value={draft.source} onChange={(event) => patchDraft({ source: event.target.value })}><option value="">Not specified</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
              </div>

              <fieldset className="effort-fieldset"><legend>Application effort</legend><div className="effort-control"><label className={draft.effort === 'quick' ? 'selected' : ''}><input type="radio" name="effort" value="quick" checked={draft.effort === 'quick'} onChange={() => patchDraft({ effort: 'quick' })} /><span><strong>Quick</strong><small>Standard online application</small></span></label><label className={draft.effort === 'targeted' ? 'selected' : ''}><input type="radio" name="effort" value="targeted" checked={draft.effort === 'targeted'} onChange={() => patchDraft({ effort: 'targeted' })} /><span><strong>Targeted</strong><small>Referral, event, or tailored materials</small></span></label></div></fieldset>

              <div className="two-fields status-update-fields">
                <label>Current status<select value={draft.status} onChange={(event) => patchDraft({ status: event.target.value as ApplicationStatus })}>{APPLICATION_STATUSES.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
                {draft.status !== (draft.history.at(-1)?.status ?? 'applied') && <label>Status date<input type="date" value={draft.statusDate} min={draft.submittedDate} onChange={(event) => patchDraft({ statusDate: event.target.value })} /></label>}
              </div>
              {entry && displayStatus === 'no_response' && draft.status === 'applied' && <p className="inline-note">Paceboard shows No response after 21 days at Applied. Choose a new status when an update arrives.</p>}

              <section className="next-action-fields" aria-labelledby="next-action-title">
                <div className="section-heading compact-heading"><div><h3 id="next-action-title">Next action</h3><p>Add a reminder to your Overview. A due date is optional.</p></div></div>
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
            </fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
          </div>

          <div className="drawer-actions">
            {entry && onDelete && <button type="button" className="button danger-text" disabled={busy} onClick={deleteApplication}><Trash2 size={16} /> {deleting ? 'Deleting…' : 'Delete application'}</button>}
            <span className="drawer-action-spacer" />
            {!entry && <button type="button" className="button secondary" disabled={busy} onClick={() => save(true)}>Save & add another</button>}
            <button type="submit" className="button primary" disabled={busy}>{saving ? 'Saving…' : entry ? 'Save changes' : 'Save application'}</button>
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
    if (!value) return null
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const draft = parsed as Record<string, unknown>
    const stringFields = ['company', 'title', 'submittedDate', 'source', 'url', 'resumeVariant', 'notes', 'nextAction', 'nextActionDueDate', 'jobDescriptionExcerpt', 'statusDate']
    if (stringFields.some((field) => typeof draft[field] !== 'string')) return null
    if (draft.effort !== 'quick' && draft.effort !== 'targeted') return null
    if (!isApplicationStatus(draft.status) || typeof draft.nextActionCompleted !== 'boolean' || !Array.isArray(draft.history)) return null
    if (draft.history.some((event) => !event || typeof event.id !== 'string' || typeof event.date !== 'string' || !isApplicationStatus(event.status))) return null
    return draft as unknown as Draft
  } catch {
    return null
  }
}

function isFocusable(element: HTMLElement): boolean {
  if (element.matches(':disabled') || (element.hasAttribute('tabindex') && Number(element.getAttribute('tabindex')) < 0)) return false
  if (element instanceof HTMLInputElement && element.type === 'hidden') return false
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.hasAttribute('inert') || ancestor.getAttribute('aria-hidden') === 'true') return false
    const style = window.getComputedStyle(ancestor)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
    if (ancestor instanceof HTMLDetailsElement && !ancestor.open) {
      const summary = [...ancestor.children].find((child) => child.tagName === 'SUMMARY')
      if (!summary?.contains(element)) return false
    }
  }
  return true
}

function postedLabel(entry: ApplicationEntry): string | undefined {
  if (!entry.postedDate) return undefined
  const days = Math.round((Date.parse(entry.submittedDate) - Date.parse(entry.postedDate)) / 86_400_000)
  return days <= 0 ? 'applied the day it was posted' : `posted ${days} ${days === 1 ? 'day' : 'days'} earlier`
}
