import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, Inbox, Link2, MailCheck, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { findPossibleDuplicate } from '../domain/gmail'
import { getDisplayStatus, statusLabel } from '../domain/status'
import type { ApplicationEffort, ApplicationEntry, ApplicationStatus, GmailCandidate } from '../domain/types'
import type { GmailReviewInput, GmailStatusReviewInput } from '../hooks/useGmailImport'
import { StatusBadge } from './StatusBadge'

interface GmailReviewProps {
  candidates: GmailCandidate[]
  dismissedCandidates: GmailCandidate[]
  entries: ApplicationEntry[]
  onAccept: (candidate: GmailCandidate, input: GmailReviewInput) => Promise<void>
  onLink: (candidate: GmailCandidate, entryId: string) => Promise<void>
  onAcceptStatus: (candidate: GmailCandidate, input: GmailStatusReviewInput) => Promise<void>
  onDismiss: (candidate: GmailCandidate) => Promise<void>
  onRestore: (candidate: GmailCandidate) => Promise<void>
}

interface ReviewDraft {
  company: string
  title: string
  submittedDate: string
  effort: ApplicationEffort
  entryId: string
  status: ApplicationStatus
  eventDate: string
  editing: boolean
}

export function GmailReview({ candidates, dismissedCandidates, entries, onAccept, onLink, onAcceptStatus, onDismiss, onRestore }: GmailReviewProps) {
  const [index, setIndex] = useState(0)
  const [tab, setTab] = useState<'pending' | 'dismissed'>('pending')
  const [drafts, setDrafts] = useState<Record<string, ReviewDraft>>({})

  useEffect(() => {
    if (index >= candidates.length) setIndex(Math.max(0, candidates.length - 1))
  }, [candidates.length, index])

  const candidate = candidates[index]
  function updateDraft(messageId: string, draft: ReviewDraft) {
    setDrafts((current) => ({ ...current, [messageId]: draft }))
  }

  return (
    <div className="page-content review-page">
      <header className="page-header review-header">
        <div><p className="context-label">Email-assisted updates</p><h1>Review Gmail matches</h1><p>Every suggestion stays pending until you confirm the application and event.</p></div>
        {candidates.length > 0 && <span className="review-total"><Inbox size={17} /> {candidates.length} pending</span>}
      </header>

      <div className="review-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'active' : ''} onClick={() => setTab('pending')}>Pending <span>{candidates.length}</span></button><button type="button" role="tab" aria-selected={tab === 'dismissed'} className={tab === 'dismissed' ? 'active' : ''} onClick={() => setTab('dismissed')}>Dismissed <span>{dismissedCandidates.length}</span></button></div>

      {tab === 'dismissed' ? <DismissedList candidates={dismissedCandidates} onRestore={onRestore} /> : !candidate ? (
        <section className="review-empty"><span><MailCheck size={28} /></span><h2>Inbox clear</h2><p>Application confirmations and suggested status changes will wait here after the next Gmail sync.</p></section>
      ) : (
        <ReviewCard
          key={candidate.messageId}
          candidate={candidate}
          entries={entries}
          draft={drafts[candidate.messageId]}
          onDraft={(draft) => updateDraft(candidate.messageId, draft)}
          position={index + 1}
          total={candidates.length}
          onPrevious={() => setIndex((value) => Math.max(0, value - 1))}
          onNext={() => setIndex((value) => Math.min(candidates.length - 1, value + 1))}
          onAccept={onAccept}
          onLink={onLink}
          onAcceptStatus={onAcceptStatus}
          onDismiss={onDismiss}
        />
      )}
    </div>
  )
}

function ReviewCard({ candidate, entries, draft: storedDraft, onDraft, position, total, onPrevious, onNext, onAccept, onLink, onAcceptStatus, onDismiss }: {
  candidate: GmailCandidate
  entries: ApplicationEntry[]
  draft?: ReviewDraft
  onDraft: (draft: ReviewDraft) => void
  position: number
  total: number
  onPrevious: () => void
  onNext: () => void
  onAccept: GmailReviewProps['onAccept']
  onLink: GmailReviewProps['onLink']
  onAcceptStatus: GmailReviewProps['onAcceptStatus']
  onDismiss: GmailReviewProps['onDismiss']
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const defaultMatches = candidate.matchedEntryIds ?? []
  const [draft, setDraftState] = useState<ReviewDraft>(() => storedDraft ?? {
    company: candidate.company,
    title: candidate.title,
    submittedDate: candidate.submittedDate,
    effort: 'quick',
    entryId: defaultMatches.length === 1 ? defaultMatches[0] : '',
    status: candidate.suggestedStatus ?? 'applied',
    eventDate: candidate.eventDate ?? candidate.submittedDate,
    editing: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const duplicate = useMemo(() => candidate.kind === 'status' ? null : findPossibleDuplicate({ ...candidate, company: draft.company, title: draft.title, submittedDate: draft.submittedDate }, entries), [candidate, draft.company, draft.submittedDate, draft.title, entries])
  const duplicateEntry = entries.find((entry) => entry.id === duplicate?.entryId)
  const matchOptions = defaultMatches.length ? entries.filter((entry) => defaultMatches.includes(entry.id)) : entries
  const selectedEntry = entries.find((entry) => entry.id === draft.entryId)

  useEffect(() => { headingRef.current?.focus() }, [])
  function patchDraft(patch: Partial<ReviewDraft>) {
    const next = { ...draft, ...patch }
    setDraftState(next)
    onDraft(next)
  }

  async function run(operation: () => Promise<void>, fallback: string) {
    setSaving(true); setError('')
    try { await operation() } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback)
      setSaving(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (candidate.kind === 'status') {
      await run(() => onAcceptStatus(candidate, { entryId: draft.entryId, status: draft.status, eventDate: draft.eventDate }), 'This status suggestion could not be applied.')
    } else {
      await run(() => onAccept(candidate, { company: draft.company, title: draft.title, submittedDate: draft.submittedDate, effort: draft.effort }), 'This application could not be added.')
    }
  }

  return (
    <section className="review-card" aria-labelledby="candidate-heading">
      <div className="review-progress"><span>{position} of {total}</span><span className={`confidence-pill ${candidate.confidence}`}>{candidate.confidence} confidence</span></div>
      <div className="email-context">
        <p className="context-label">{candidate.kind === 'status' ? 'Suggested status update' : 'Detected application confirmation'}</p>
        <h2 id="candidate-heading" ref={headingRef} tabIndex={-1}>{candidate.subject}</h2>
        <p>{candidate.sender}</p>
        {candidate.supportingSnippet && <blockquote>{candidate.supportingSnippet}</blockquote>}
        <div><time dateTime={candidate.receivedAt}>{new Date(candidate.receivedAt).toLocaleString()}</time><a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(candidate.threadId)}`} target="_blank" rel="noreferrer">Supporting email <ExternalLink size={14} /></a></div>
      </div>

      <form onSubmit={submit}>
        {candidate.kind === 'status' ? <>
          <div className="suggestion-route"><span>Existing application</span>{selectedEntry ? <button type="button" className="matched-application" onClick={() => patchDraft({ editing: true })}><strong>{selectedEntry.company}</strong><span>{selectedEntry.title}</span><StatusBadge status={getDisplayStatus(selectedEntry)} /></button> : <p className="duplicate-warning"><AlertTriangle size={17} />Choose the application this email belongs to.</p>}</div>
          {(draft.editing || defaultMatches.length !== 1) && <label>Application<select required aria-label="Application for Gmail suggestion" value={draft.entryId} onChange={(event) => patchDraft({ entryId: event.target.value })}><option value="">Choose application…</option>{matchOptions.map((entry) => <option key={entry.id} value={entry.id}>{entry.company} — {entry.title} ({entry.submittedDate})</option>)}</select></label>}
          <div className="suggested-change"><span>Suggested change</span><strong>{statusLabel(draft.status)}</strong><time dateTime={draft.eventDate}>{draft.eventDate}</time></div>
          {draft.editing && <div className="two-fields"><label>Status<select value={draft.status} onChange={(event) => patchDraft({ status: event.target.value as ApplicationStatus })}><option value="online_assessment">Online assessment</option><option value="interview">Interview</option><option value="rejected">Rejected</option></select></label><label>Event date<input type="date" min={selectedEntry?.submittedDate} value={draft.eventDate} onChange={(event) => patchDraft({ eventDate: event.target.value })} /></label></div>}
        </> : <>
          <div className="two-fields"><label>Company<input required value={draft.company} onChange={(event) => patchDraft({ company: event.target.value })} autoComplete="organization" /></label><label>Role title<input required value={draft.title} onChange={(event) => patchDraft({ title: event.target.value })} /></label></div>
          <label className="review-date">Submitted<input required type="date" value={draft.submittedDate} onChange={(event) => patchDraft({ submittedDate: event.target.value })} /></label>
          <fieldset className="effort-fieldset" aria-label="Application effort"><legend>Application effort</legend><div className="effort-control"><label className={draft.effort === 'quick' ? 'selected' : ''}><input type="radio" name={`effort-${candidate.messageId}`} checked={draft.effort === 'quick'} onChange={() => patchDraft({ effort: 'quick' })} /><span><strong>Quick</strong><small>Most online applications</small></span></label><label className={draft.effort === 'targeted' ? 'selected' : ''}><input type="radio" name={`effort-${candidate.messageId}`} checked={draft.effort === 'targeted'} onChange={() => patchDraft({ effort: 'targeted' })} /><span><strong>Targeted</strong><small>Referral or tailored materials</small></span></label></div></fieldset>
          {duplicateEntry && <div className="duplicate-comparison"><p><AlertTriangle size={17} /><span>{duplicate?.kind === 'exact' ? 'Paceboard already has this company, role, and date.' : 'A similar application is already recorded.'}</span></p><div><strong>{duplicateEntry.company}</strong><span>{duplicateEntry.title}</span><small>Submitted {duplicateEntry.submittedDate} · {duplicateEntry.effort === 'quick' ? 'Quick' : 'Targeted'}</small></div></div>}
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="review-actions">
          <div className="review-pagination"><button type="button" className="icon-button" onClick={onPrevious} disabled={position === 1} aria-label="Previous Gmail match"><ArrowLeft size={18} /></button><button type="button" className="icon-button" onClick={onNext} disabled={position === total} aria-label="Next Gmail match"><ArrowRight size={18} /></button></div>
          <span className="drawer-action-spacer" />
          <button type="button" className="button danger-text" disabled={saving} onClick={() => void run(() => onDismiss(candidate), 'This match could not be dismissed.')}><Trash2 size={16} /> Dismiss</button>
          {candidate.kind === 'status' ? <><button type="button" className="button secondary" onClick={() => patchDraft({ editing: !draft.editing })}>Edit</button><button type="submit" className="button primary" disabled={saving || !draft.entryId}><Check size={16} /> {saving ? 'Applying…' : 'Accept'}</button></> : duplicateEntry ? <><button type="button" className="button secondary" disabled={saving} onClick={() => void run(() => onLink(candidate, duplicateEntry.id), 'This email could not be linked.')}><Link2 size={16} /> Link to existing</button><button type="submit" className="button primary" disabled={saving}><Check size={16} /> Add separately</button></> : <button type="submit" className="button primary" disabled={saving}><Check size={16} /> {saving ? 'Adding…' : 'Add & next'}</button>}
        </div>
      </form>
    </section>
  )
}

function DismissedList({ candidates, onRestore }: { candidates: GmailCandidate[]; onRestore: (candidate: GmailCandidate) => Promise<void> }) {
  if (!candidates.length) return <section className="review-empty"><span><RotateCcw size={28} /></span><h2>No dismissed items</h2><p>Dismissed suggestions stay recoverable here.</p></section>
  return <section className="dismissed-list"><h2>Dismissed items</h2>{candidates.map((candidate) => <article key={candidate.messageId}><div><strong>{candidate.company}</strong><span>{candidate.title}</span><small>{candidate.subject}</small></div><button type="button" className="button secondary" onClick={() => void onRestore(candidate)}><RotateCcw size={16} /> Restore</button></article>)}</section>
}
