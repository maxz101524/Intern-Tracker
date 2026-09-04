import { ExternalLink, MoreHorizontal } from 'lucide-react'
import { formatShortDate } from '../domain/analytics'
import { getDisplayStatus, todayDate } from '../domain/status'
import type { ApplicationEntry } from '../domain/types'
import { StatusBadge } from './StatusBadge'

interface ApplicationTableProps {
  entries: ApplicationEntry[]
  onEdit: (entry: ApplicationEntry) => void
  compact?: boolean
  emptyMessage?: string
}

export function ApplicationTable({ entries, onEdit, compact = false, emptyMessage = 'No applications match these filters.' }: ApplicationTableProps) {
  const today = todayDate()
  if (entries.length === 0) {
    return <div className="empty-state"><strong>{emptyMessage}</strong><span>Add a role or adjust the filters to continue.</span></div>
  }

  return (
    <div className={`application-table${compact ? ' compact' : ''}`} role="table" aria-label="Applications">
      <div className="application-table-head" role="row">
        <span role="columnheader">Company</span>
        <span role="columnheader">Role</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Submitted</span>
        {!compact && <span role="columnheader">Effort</span>}
        {!compact && <span role="columnheader">Source</span>}
        <span className="sr-only" role="columnheader">Actions</span>
      </div>
      {entries.map((entry) => (
        <div className="application-row" role="row" key={entry.id}>
          <strong role="cell">{entry.company}</strong>
          <span className="role-cell" role="cell">{entry.title}</span>
          <span role="cell"><StatusBadge status={getDisplayStatus(entry, today)} /></span>
          <time role="cell" dateTime={entry.submittedDate}>{formatShortDate(entry.submittedDate)}</time>
          {!compact && <span className={`effort-label ${entry.effort}`} role="cell">{entry.effort === 'quick' ? 'Quick' : 'Targeted'}</span>}
          {!compact && <span className="source-cell" role="cell">{entry.source ?? '—'}</span>}
          <span className="row-actions" role="cell">
            {entry.url && <a href={entry.url} target="_blank" rel="noreferrer" aria-label={`Open ${entry.company} job listing`}><ExternalLink size={16} /></a>}
            <button type="button" className="icon-button" onClick={() => onEdit(entry)} aria-label={`Edit ${entry.company} ${entry.title}`}><MoreHorizontal size={19} /></button>
          </span>
        </div>
      ))}
    </div>
  )
}
