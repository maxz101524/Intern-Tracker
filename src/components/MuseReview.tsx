import { AlertTriangle, Check, CircleCheck, ExternalLink, FilePlus2, GitMerge, History, RotateCcw, Sparkles, Trash2, Undo2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { statusLabel } from '../domain/status'
import type { ApplicationEntry, MuseEntryItem, MuseFillField, MuseItem, MuseReviewReason, MuseStatusItem } from '../domain/types'
import type { MuseSyncController } from '../hooks/useMuseSync'
import { ApplicationPicker } from './GmailReview'

const REASONS: Record<MuseReviewReason, { label: string; detail: string }> = {
  possible_duplicate: { label: 'Possible duplicate', detail: 'Paceboard already has a similar role. Decide whether this is the same application.' },
  unmatched: { label: 'Which role?', detail: 'Muse could not tie this update to exactly one role. Choose the role it belongs to.' },
  low_confidence: { label: 'Muse wasn’t sure', detail: 'Muse inferred this from the email wording. Confirm it before the role changes.' },
  closed_application: { label: 'Role already closed', detail: 'This role is already rejected or withdrawn. Apply only if the update is real.' },
  invalid: { label: 'Needs attention', detail: 'Muse sent something Paceboard cannot record as-is.' },
  undone: { label: 'You undid this', detail: 'You undid this earlier. Apply it again or dismiss it.' },
}

const FIELD_LABELS: Record<MuseFillField, string> = {
  url: 'job link', source: 'source', resumeVariant: 'resume', notes: 'notes', origin: 'confirmation email',
}

type Tab = 'review' | 'activity' | 'dismissed'

export function MuseReview({ muse, entries, switcher }: { muse: MuseSyncController; entries: ApplicationEntry[]; switcher?: ReactNode }) {
  const [tab, setTab] = useState<Tab>('review')
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries])

  return (
    <div className="page-content review-page">
      <header className="page-header review-header">
        <div><p className="context-label">Automatic updates</p><h1>Muse updates</h1><p>Clean updates from Muse are applied for you. Only items that need a decision wait here.</p></div>
      </header>
      {switcher}
      <div className="review-tabs" role="tablist">
        <TabButton active={tab === 'review'} onClick={() => setTab('review')} label="Needs review" count={muse.pendingItems.length} />
        <TabButton active={tab === 'activity'} onClick={() => setTab('activity')} label="Activity" count={muse.appliedItems.length} />
        <TabButton active={tab === 'dismissed'} onClick={() => setTab('dismissed')} label="Dismissed" count={muse.dismissedItems.length} />
      </div>

      {tab === 'review' && (muse.pendingItems.length ? (
        <div className="muse-card-list">
          {muse.pendingItems.map((item) => item.kind === 'entry'
            ? <EntryCard key={item.key} item={item} suggestion={entryById.get(item.suggestedEntryIds?.[0] ?? '')} muse={muse} />
            : <StatusCard key={item.key} item={item} entries={entries} muse={muse} />)}
        </div>
      ) : (
        <section className="review-empty"><span><CircleCheck size={28} /></span><h2>Nothing needs you</h2><p>{muse.connected ? 'New roles and status changes from Muse are applied automatically. Anything ambiguous will wait here.' : 'Connect Muse in Settings & data to receive roles and status changes automatically.'}</p></section>
      ))}

      {tab === 'activity' && <ActivityList items={muse.appliedItems} entryById={entryById} onUndo={muse.undo} />}
      {tab === 'dismissed' && <DismissedList items={muse.dismissedItems} entryById={entryById} onRestore={muse.restore} />}
    </div>
  )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return <button type="button" role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>{label} <span>{count}</span></button>
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(operation: () => Promise<void>) {
    setBusy(true); setError('')
    try { await operation() } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'This update could not be saved.')
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function CardHeader({ item, kind }: { item: MuseItem; kind: string }) {
  const reason = REASONS[item.reason ?? 'invalid']
  return <>
    <div className="review-progress"><span className={`muse-reason ${item.reason ?? 'invalid'}`}>{reason.label}</span><time dateTime={item.receivedAt}>From Muse · {new Date(item.receivedAt).toLocaleString()}</time></div>
    <p className="context-label">{kind}</p>
    <p className="muse-reason-detail">{item.detail ?? reason.detail}</p>
  </>
}

function EntryCard({ item, suggestion, muse }: { item: MuseEntryItem; suggestion?: ApplicationEntry; muse: MuseSyncController }) {
  const { busy, error, run } = useAction()
  const role = item.payload
  const invalid = item.reason === 'invalid'
  return (
    <article className="review-card muse-card" aria-label={`${role.company} ${role.title}`}>
      <div className="muse-card-body">
        <CardHeader item={item} kind="New role from Muse" />
        <h2>{role.company} <span>— {role.title}</span></h2>
        <dl className="muse-facts">
          <div><dt>Submitted</dt><dd>{role.submittedDate}</dd></div>
          {role.source && <div><dt>Source</dt><dd>{role.source}</dd></div>}
          {role.resumeVariant && <div><dt>Resume</dt><dd>{role.resumeVariant}</dd></div>}
          <div><dt>Effort</dt><dd>{role.effort === 'quick' ? 'Quick' : 'Targeted'}</dd></div>
        </dl>
        {role.url && <a className="muse-link" href={role.url} target="_blank" rel="noreferrer">Job posting <ExternalLink size={14} /></a>}
        {role.notes && <blockquote>{role.notes}</blockquote>}
        {suggestion && <div className="duplicate-comparison"><p><AlertTriangle size={17} /><span>Already in Paceboard</span></p><div><strong>{suggestion.company}</strong><span>{suggestion.title}</span><small>Submitted {suggestion.submittedDate}{suggestion.url ? ` · ${suggestion.url}` : ' · no job link saved'}</small></div></div>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="review-actions muse-actions">
        <button type="button" className="button danger-text" disabled={busy} onClick={() => void run(() => muse.dismiss(item))}><Trash2 size={16} /> Dismiss</button>
        <span className="drawer-action-spacer" />
        {!invalid && suggestion && <button type="button" className="button primary" disabled={busy} onClick={() => void run(() => muse.resolveEntry(item, { mode: 'fill', entryId: suggestion.id }))}><GitMerge size={16} /> Same role — fill blanks</button>}
        {!invalid && <button type="button" className={`button ${suggestion ? 'secondary' : 'primary'}`} disabled={busy} onClick={() => void run(() => muse.resolveEntry(item, { mode: 'create' }))}><FilePlus2 size={16} /> Add as new role</button>}
      </div>
    </article>
  )
}

function StatusCard({ item, entries, muse }: { item: MuseStatusItem; entries: ApplicationEntry[]; muse: MuseSyncController }) {
  const { busy, error, run } = useAction()
  const update = item.payload
  const recommended = useMemo(() => item.suggestedEntryIds ?? [], [item.suggestedEntryIds])
  const [entryId, setEntryId] = useState(recommended[0] ?? '')
  const [query, setQuery] = useState('')
  const options = useMemo(() => {
    const search = query.toLowerCase().trim()
    const rank = (entry: ApplicationEntry) => { const index = recommended.indexOf(entry.id); return index < 0 ? Number.MAX_SAFE_INTEGER : index }
    return entries
      .filter((entry) => !search || `${entry.company} ${entry.title} ${entry.submittedDate}`.toLowerCase().includes(search))
      .sort((left, right) => rank(left) - rank(right) || right.submittedDate.localeCompare(left.submittedDate))
      .slice(0, search ? 20 : 8)
  }, [entries, query, recommended])

  return (
    <article className="review-card muse-card" aria-label={`${statusLabel(update.status)} update`}>
      <div className="muse-card-body">
        <CardHeader item={item} kind="Status update from Muse" />
        <h2>{statusLabel(update.status)} <span>· {update.date}</span></h2>
        {update.match && <p className="muse-match">Muse matched it to <strong>{update.match.company}</strong> — {update.match.title} (submitted {update.match.submittedDate})</p>}
        {update.note && <blockquote>{update.note}</blockquote>}
        {update.origin && <a className="muse-link" href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(update.origin.messageId)}`} target="_blank" rel="noreferrer">Supporting email <ExternalLink size={14} /></a>}
        {item.reason !== 'invalid' && <ApplicationPicker entries={options} recommendedIds={recommended} selectedId={entryId} query={query} onQuery={setQuery} onSelect={setEntryId} />}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="review-actions muse-actions">
        <button type="button" className="button danger-text" disabled={busy} onClick={() => void run(() => muse.dismiss(item))}><Trash2 size={16} /> Dismiss</button>
        <span className="drawer-action-spacer" />
        {item.reason !== 'invalid' && <button type="button" className="button primary" disabled={busy || !entryId} onClick={() => void run(() => muse.applyStatus(item, entryId))}><Check size={16} /> Apply update</button>}
      </div>
    </article>
  )
}

function describe(item: MuseItem, entryById: Map<string, ApplicationEntry>): { name: string; change: string; note?: string } {
  const entry = entryById.get(item.result?.entryId ?? '')
  if (item.kind === 'entry') {
    const name = `${entry?.company ?? item.payload.company} — ${entry?.title ?? item.payload.title}`
    if (item.result?.action === 'filled') {
      const fields = (item.result.filledFields ?? []).map((field) => FIELD_LABELS[field])
      return { name, change: fields.length ? `Filled in ${fields.join(', ')}` : 'Linked to an existing role' }
    }
    return { name, change: `Added role · submitted ${item.payload.submittedDate}${item.payload.source ? ` via ${item.payload.source}` : ''}` }
  }
  const match = item.payload.match
  const name = entry ? `${entry.company} — ${entry.title}` : match ? `${match.company} — ${match.title}` : 'A role no longer in Paceboard'
  return { name, change: `${statusLabel(item.payload.status)} on ${item.payload.date}`, note: item.payload.note }
}

function ActivityList({ items, entryById, onUndo }: { items: MuseItem[]; entryById: Map<string, ApplicationEntry>; onUndo: (item: MuseItem) => Promise<void> }) {
  if (!items.length) return <section className="review-empty"><span><History size={28} /></span><h2>No Muse activity yet</h2><p>Roles and status changes Muse applies will be listed here with an undo option.</p></section>
  return (
    <section className="dismissed-list muse-activity" aria-label="Muse activity">
      {items.slice(0, 100).map((item) => {
        const { name, change, note } = describe(item, entryById)
        return <article key={item.key}>
          <span className={`muse-activity-icon ${item.kind}`} aria-hidden="true">{item.kind === 'entry' ? <Sparkles size={15} /> : <Check size={15} />}</span>
          <div><strong>{name}</strong><span>{change}</span>{note && <small>{note}</small>}</div>
          <time dateTime={item.reviewedAt ?? item.receivedAt}>{new Date(item.reviewedAt ?? item.receivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
          <button type="button" className="button secondary" onClick={() => void onUndo(item)} aria-label={`Undo ${change} for ${name}`}><Undo2 size={15} /> Undo</button>
        </article>
      })}
    </section>
  )
}

function DismissedList({ items, entryById, onRestore }: { items: MuseItem[]; entryById: Map<string, ApplicationEntry>; onRestore: (item: MuseItem) => Promise<void> }) {
  if (!items.length) return <section className="review-empty"><span><RotateCcw size={28} /></span><h2>No dismissed items</h2><p>Dismissed and undone Muse updates stay recoverable here.</p></section>
  return (
    <section className="dismissed-list"><h2>Dismissed Muse updates</h2>
      {items.map((item) => {
        const { name, change } = describe(item, entryById)
        return <article key={item.key}><div><strong>{name}</strong><span>{change}</span><small>{REASONS[item.reason ?? 'invalid'].label}</small></div><button type="button" className="button secondary" onClick={() => void onRestore(item)}><RotateCcw size={16} /> Restore</button></article>
      })}
    </section>
  )
}
