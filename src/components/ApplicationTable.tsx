import { ExternalLink, MoreHorizontal } from 'lucide-react'
import { formatShortDate } from '../domain/analytics'
import { APPLICATION_STATUSES, daysSinceUpdate, getDisplayStatus, statusLabel, todayDate } from '../domain/status'
import type { ApplicationColumn, ApplicationEntry, ApplicationStatus } from '../domain/types'
import { StatusBadge } from './StatusBadge'

interface ApplicationTableProps {
  entries: ApplicationEntry[]
  onEdit: (entry: ApplicationEntry) => void
  onStatusChange?: (entry: ApplicationEntry, status: ApplicationStatus) => void
  compact?: boolean
  emptyMessage?: string
  visibleColumns?: ApplicationColumn[]
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
}

export function ApplicationTable({
  entries,
  onEdit,
  onStatusChange,
  compact = false,
  emptyMessage = 'No applications match these filters.',
  visibleColumns = ['effort', 'source'],
  selectedIds,
  onSelectionChange,
}: ApplicationTableProps) {
  const today = todayDate()
  if (entries.length === 0) {
    return <div className="empty-state"><strong>{emptyMessage}</strong><span>Add a role or adjust the filters to continue.</span></div>
  }

  const selectable = Boolean(selectedIds && onSelectionChange && !compact)
  const allSelected = selectable && entries.every((entry) => selectedIds!.has(entry.id))
  const columns = compact ? [] : visibleColumns

  function selectAll(checked: boolean) {
    if (!selectedIds || !onSelectionChange) return
    const next = new Set(selectedIds)
    for (const entry of entries) {
      if (checked) next.add(entry.id)
      else next.delete(entry.id)
    }
    onSelectionChange(next)
  }

  function selectOne(id: string, checked: boolean) {
    if (!selectedIds || !onSelectionChange) return
    const next = new Set(selectedIds)
    if (checked) next.add(id)
    else next.delete(id)
    onSelectionChange(next)
  }

  return (
    <div className={`application-table${compact ? ' compact' : ''}`}>
      <table>
        <thead><tr>
          {selectable && <th className="select-cell"><input type="checkbox" aria-label="Select all shown applications" checked={allSelected} onChange={(event) => selectAll(event.target.checked)} /></th>}
          <th>Company</th><th>Role</th><th>Status</th><th>Submitted</th>
          {columns.includes('effort') && <th>Effort</th>}
          {columns.includes('source') && <th>Source</th>}
          {columns.includes('resumeVariant') && <th>Resume</th>}
          {columns.includes('nextAction') && <th>Next action</th>}
          {columns.includes('daysSinceUpdate') && <th>Days since update</th>}
          <th><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>{entries.map((entry) => {
          const displayStatus = getDisplayStatus(entry, today)
          return <tr key={entry.id}>
            {selectable && <td className="select-cell"><input type="checkbox" aria-label={`Select ${entry.company} ${entry.title}`} checked={selectedIds!.has(entry.id)} onChange={(event) => selectOne(entry.id, event.target.checked)} /></td>}
            <td><button type="button" className="row-link strong" onClick={() => onEdit(entry)}>{entry.company}</button></td>
            <td className="role-cell"><button type="button" className="row-link" onClick={() => onEdit(entry)}>{entry.title}</button></td>
            <td>{onStatusChange && !compact ? <select className={`status-select status-${displayStatus}`} aria-label={`Status for ${entry.company} ${entry.title}`} value={displayStatus} onChange={(event) => onStatusChange(entry, event.target.value as ApplicationStatus)}>{displayStatus === 'no_response' && <option value="no_response" disabled>No response</option>}{APPLICATION_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select> : <StatusBadge status={displayStatus} />}</td>
            <td><time dateTime={entry.submittedDate}>{formatShortDate(entry.submittedDate)}</time></td>
            {columns.includes('effort') && <td><span className={`effort-label ${entry.effort}`}>{entry.effort === 'quick' ? 'Quick' : 'Targeted'}</span></td>}
            {columns.includes('source') && <td className="source-cell">{entry.source ?? '—'}</td>}
            {columns.includes('resumeVariant') && <td>{entry.resumeVariant ?? '—'}</td>}
            {columns.includes('nextAction') && <td className="next-action-cell">{entry.nextAction ? <><span className={entry.nextActionCompleted ? 'completed' : ''}>{entry.nextAction}</span>{entry.nextActionDueDate && <small>{formatShortDate(entry.nextActionDueDate)}</small>}</> : '—'}</td>}
            {columns.includes('daysSinceUpdate') && <td>{daysSinceUpdate(entry, today)}</td>}
            <td className="row-actions">
              {entry.url && <a href={entry.url} target="_blank" rel="noreferrer" aria-label={`Open ${entry.company} job listing`}><ExternalLink size={16} /></a>}
              <button type="button" className="icon-button" onClick={() => onEdit(entry)} aria-label={`Edit ${entry.company} ${entry.title}`}><MoreHorizontal size={19} /></button>
            </td>
          </tr>
        })}</tbody>
      </table>
    </div>
  )
}
