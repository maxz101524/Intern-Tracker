import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, Inbox, MailCheck, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { findPossibleDuplicate } from '../domain/gmail'
import type { ApplicationEffort, ApplicationEntry, GmailCandidate } from '../domain/types'
import type { GmailReviewInput } from '../hooks/useGmailImport'

interface GmailReviewProps {
  candidates: GmailCandidate[]
  entries: ApplicationEntry[]
  onAccept: (candidate: GmailCandidate, input: GmailReviewInput) => Promise<void>
  onDismiss: (candidate: GmailCandidate) => Promise<void>
}

export function GmailReview({ candidates, entries, onAccept, onDismiss }: GmailReviewProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (index >= candidates.length) setIndex(Math.max(0, candidates.length - 1))
  }, [candidates.length, index])

  const candidate = candidates[index]
  return (
    <div className="page-content review-page">
      <header className="page-header review-header">
        <div><p className="context-label">Confirmation inbox</p><h1>Review Gmail matches</h1><p>Confirm the role and classify the effort. Quick is selected by default.</p></div>
        {candidates.length > 0 && <span className="review-total"><Inbox size={17} /> {candidates.length} pending</span>}
      </header>

      {!candidate ? (
        <section className="review-empty">
          <span><MailCheck size={28} /></span>
          <h2>Inbox clear</h2>
          <p>New application confirmations will wait here after the next Gmail sync. Syncing again also retries messages that could not be read.</p>
        </section>
      ) : (
        <ReviewCard
          key={candidate.messageId}
          candidate={candidate}
          entries={entries}
          position={index + 1}
          total={candidates.length}
          onPrevious={() => setIndex((value) => Math.max(0, value - 1))}
          onNext={() => setIndex((value) => Math.min(candidates.length - 1, value + 1))}
          onAccept={onAccept}
          onDismiss={onDismiss}
        />
      )}
    </div>
  )
}

function ReviewCard({
  candidate,
  entries,
  position,
  total,
  onPrevious,
  onNext,
  onAccept,
  onDismiss,
}: {
  candidate: GmailCandidate
  entries: ApplicationEntry[]
  position: number
  total: number
  onPrevious: () => void
  onNext: () => void
  onAccept: GmailReviewProps['onAccept']
  onDismiss: GmailReviewProps['onDismiss']
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [company, setCompany] = useState(candidate.company)
  const [title, setTitle] = useState(candidate.title)
  const [submittedDate, setSubmittedDate] = useState(candidate.submittedDate)
  const [effort, setEffort] = useState<ApplicationEffort>('quick')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const duplicate = useMemo(
    () => findPossibleDuplicate({ ...candidate, company, title, submittedDate }, entries),
    [candidate, company, entries, submittedDate, title],
  )

  useEffect(() => { headingRef.current?.focus() }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onAccept(candidate, { company, title, submittedDate, effort })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This application could not be added.')
      setSaving(false)
    }
  }

  async function dismiss() {
    setSaving(true)
    setError('')
    try {
      await onDismiss(candidate)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This match could not be dismissed.')
      setSaving(false)
    }
  }

  return (
    <section className="review-card" aria-labelledby="candidate-heading">
      <div className="review-progress">
        <span>{position} of {total}</span>
        <span className={`confidence-pill ${candidate.confidence}`}>{candidate.confidence} confidence</span>
      </div>
      <div className="email-context">
        <p className="context-label">Detected from Gmail</p>
        <h2 id="candidate-heading" ref={headingRef} tabIndex={-1}>{candidate.subject}</h2>
        <p>{candidate.sender}</p>
        <div><time dateTime={candidate.receivedAt}>{new Date(candidate.receivedAt).toLocaleString()}</time><a href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(candidate.threadId)}`} target="_blank" rel="noreferrer">Open in Gmail <ExternalLink size={14} /></a></div>
      </div>

      <form onSubmit={submit}>
        <div className="two-fields">
          <label>Company<input required value={company} onChange={(event) => setCompany(event.target.value)} autoComplete="organization" /></label>
          <label>Role title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        </div>
        <label className="review-date">Submitted<input required type="date" value={submittedDate} onChange={(event) => setSubmittedDate(event.target.value)} /></label>

        <fieldset className="effort-fieldset" aria-label="Application effort">
          <legend>Application effort</legend>
          <div className="effort-control">
            <label className={effort === 'quick' ? 'selected' : ''}><input type="radio" name={`effort-${candidate.messageId}`} checked={effort === 'quick'} onChange={() => setEffort('quick')} /><span><strong>Quick</strong><small>Most online applications</small></span></label>
            <label className={effort === 'targeted' ? 'selected' : ''}><input type="radio" name={`effort-${candidate.messageId}`} checked={effort === 'targeted'} onChange={() => setEffort('targeted')} /><span><strong>Targeted</strong><small>Referral or tailored materials</small></span></label>
          </div>
        </fieldset>

        {duplicate && <p className="duplicate-warning" role="status"><AlertTriangle size={17} />{duplicate.kind === 'exact' ? 'Paceboard already has this company, role, and date.' : 'A similar role exists within three days.'} You can still add it.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}

        <div className="review-actions">
          <div className="review-pagination">
            <button type="button" className="icon-button" onClick={onPrevious} disabled={position === 1} aria-label="Previous Gmail match"><ArrowLeft size={18} /></button>
            <button type="button" className="icon-button" onClick={onNext} disabled={position === total} aria-label="Next Gmail match"><ArrowRight size={18} /></button>
          </div>
          <span className="drawer-action-spacer" />
          <button type="button" className="button danger-text" disabled={saving} onClick={dismiss}><Trash2 size={16} /> Dismiss</button>
          <button type="submit" className="button primary" disabled={saving}><Check size={16} /> {saving ? 'Adding…' : 'Add & next'}</button>
        </div>
      </form>
    </section>
  )
}
