import { useEffect, useState, type FormEvent } from 'react'
import { ExternalLink, Split, Trash2, X } from 'lucide-react'
import type { ApplicationEntry, ApplicationOutcome, ApplicationType, EntryDetails } from '../domain/types'

interface EntryDrawerProps {
  entry: ApplicationEntry
  sources: string[]
  onClose: () => void
  onSave: (entry: ApplicationEntry) => Promise<void>
  onDelete: (entry: ApplicationEntry) => Promise<void>
  onSplit: (entry: ApplicationEntry, details: EntryDetails) => Promise<void>
}

const outcomes: { value: ApplicationOutcome | ''; label: string }[] = [
  { value: '', label: 'No meaningful response' },
  { value: 'assessment', label: 'Assessment' },
  { value: 'recruiter_screen', label: 'Recruiter screen' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer', label: 'Offer' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

export function EntryDrawer({ entry, sources, onClose, onSave, onDelete, onSplit }: EntryDrawerProps) {
  const [quantity, setQuantity] = useState(entry.quantity)
  const [type, setType] = useState<ApplicationType>(entry.type)
  const [source, setSource] = useState(entry.source ?? '')
  const [company, setCompany] = useState(entry.company ?? '')
  const [title, setTitle] = useState(entry.title ?? '')
  const [url, setUrl] = useState(entry.url ?? '')
  const [resumeVariant, setResumeVariant] = useState(entry.resumeVariant ?? '')
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [outcome, setOutcome] = useState<ApplicationOutcome | ''>(entry.outcome ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isBatch = entry.quantity > 1
  const [mode, setMode] = useState<'edit' | 'split'>('edit')

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (mode === 'split') {
        await onSplit(entry, {
          type,
          source: source || undefined,
          company: company || undefined,
          title: title || undefined,
          url: url || undefined,
          resumeVariant: resumeVariant || undefined,
          notes: notes || undefined,
          outcome: outcome || undefined,
        })
      } else {
        await onSave({
          ...entry,
          quantity,
          type,
          source: source || undefined,
          ...(isBatch
            ? { company: undefined, title: undefined, url: undefined, resumeVariant: undefined, notes: undefined, outcome: undefined }
            : {
                company: company || undefined,
                title: title || undefined,
                url: url || undefined,
                resumeVariant: resumeVariant || undefined,
                notes: notes || undefined,
                outcome: outcome || undefined,
              }),
          updatedAt: new Date().toISOString(),
        })
      }
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The entry could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="entry-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header>
          <div>
            <p className="context-label">{mode === 'split' ? 'Promote from batch' : isBatch ? 'Aggregate batch' : 'Application details'}</p>
            <h2 id="drawer-title">{mode === 'split' ? 'Split one application out' : isBatch ? `${entry.quantity} applications` : entry.company || entry.title || 'Application'}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X /></button>
        </header>

        {isBatch && mode === 'edit' && (
          <button type="button" className="split-callout" onClick={() => { setMode('split'); setQuantity(1) }}>
            <Split size={19} /><span><strong>One of these got a response?</strong><small>Split it into a detailed application without changing your total.</small></span>
          </button>
        )}

        <form onSubmit={submit} className="drawer-form">
          {mode === 'edit' && (
            <label>Quantity<input type="number" min="1" max="500" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} disabled={!isBatch} /></label>
          )}
          <div className="two-fields">
            <label>Type<select value={type} onChange={(event) => setType(event.target.value as ApplicationType)}><option value="quick">Quick</option><option value="targeted">Targeted</option></select></label>
            <label>Source<select value={source} onChange={(event) => setSource(event.target.value)}><option value="">Not specified</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>

          {(!isBatch || mode === 'split') && (
            <>
              <label>Company<input value={company} onChange={(event) => setCompany(event.target.value)} /></label>
              <label>Role<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
              <label>Job URL<div className="input-with-icon"><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" />{url && <a href={url} target="_blank" rel="noreferrer" aria-label="Open job listing"><ExternalLink size={17} /></a>}</div></label>
              <label>Resume version<select value={resumeVariant} onChange={(event) => setResumeVariant(event.target.value)}><option value="">Not specified</option><option>ML</option><option>DS</option><option>Hybrid</option><option>Tailored</option></select></label>
              <label>Meaningful outcome<select value={outcome} onChange={(event) => setOutcome(event.target.value as ApplicationOutcome | '')}>{outcomes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
              <label>Notes<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Only what will help later." /></label>
            </>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="drawer-actions">
            {mode === 'edit' ? (
              <button type="button" className="button danger-text" onClick={() => onDelete(entry)} aria-label="Delete entry"><Trash2 size={17} /> Delete</button>
            ) : (
              <button type="button" className="button secondary" onClick={() => setMode('edit')}>Cancel split</button>
            )}
            <button className="button primary" disabled={saving}>{saving ? 'Saving…' : mode === 'split' ? 'Split and save' : 'Save changes'}</button>
          </div>
        </form>
      </aside>
    </div>
  )
}
