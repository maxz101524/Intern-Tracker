import { BriefcaseBusiness, Clock3, ExternalLink, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef } from 'react'
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
  emptyDescription?: string
  emptyAction?: { label: string; onClick: () => void }
  visibleColumns?: ApplicationColumn[]
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  selectionDisabled?: boolean
  statusChangesDisabled?: boolean
  pendingStatusId?: string | null
  statusError?: { entryId: string; message: string } | null
}

export function ApplicationTable({
  entries,
  onEdit,
  onStatusChange,
  compact = false,
  emptyMessage = 'No applications match these filters.',
  emptyDescription = 'Add a role or adjust the filters to continue.',
  emptyAction,
  visibleColumns = ['effort', 'source'],
  selectedIds,
  onSelectionChange,
  selectionDisabled = false,
  statusChangesDisabled = false,
  pendingStatusId,
  statusError,
}: ApplicationTableProps) {
  const today = todayDate()
  const selectAllRef = useRef<HTMLInputElement>(null)
  const selectable = Boolean(selectedIds && onSelectionChange && !compact)
  const selectedCount = entries.filter((entry) => selectedIds?.has(entry.id)).length
  const allSelected = selectable && entries.length > 0 && selectedCount === entries.length
  const someSelected = selectable && selectedCount > 0 && !allSelected
  const columns = compact ? [] : visibleColumns

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected
  }, [someSelected])

  if (entries.length === 0) {
    return <div className="empty-state ledger-empty"><span className="empty-state-icon" aria-hidden="true"><BriefcaseBusiness size={26} /></span><strong>{emptyMessage}</strong><span className="empty-description">{emptyDescription}</span>{emptyAction && <button type="button" className="button primary" onClick={emptyAction.onClick}>{emptyAction.label}</button>}</div>
  }

  function selectAll(checked: boolean) {
    if (!onSelectionChange || selectionDisabled) return
    onSelectionChange(checked ? new Set(entries.map((entry) => entry.id)) : new Set())
  }

  function selectOne(id: string, checked: boolean) {
    if (!selectedIds || !onSelectionChange || selectionDisabled) return
    const visibleIds = new Set(entries.map((entry) => entry.id))
    const next = new Set([...selectedIds].filter((selectedId) => visibleIds.has(selectedId)))
    if (checked) next.add(id)
    else next.delete(id)
    onSelectionChange(next)
  }

  return (
    <div className={`application-table${compact ? ' compact' : ''}`}>
      <table>
        <caption className="sr-only">Application records</caption>
        <thead><tr>
          {selectable && <th className="select-cell" scope="col"><input ref={selectAllRef} type="checkbox" aria-label="Select all shown applications" aria-checked={someSelected ? 'mixed' : allSelected} checked={allSelected} disabled={selectionDisabled} onChange={(event) => selectAll(event.target.checked)} /></th>}
          <th scope="col">Company</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Submitted</th>
          {columns.includes('effort') && <th scope="col">Effort</th>}
          {columns.includes('source') && <th scope="col">Source</th>}
          {columns.includes('resumeVariant') && <th scope="col">Resume</th>}
          {columns.includes('nextAction') && <th scope="col">Next action</th>}
          {columns.includes('daysSinceUpdate') && <th scope="col">Days since update</th>}
          <th scope="col"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>{entries.map((entry) => {
          const displayStatus = getDisplayStatus(entry, today)
          const initials = entry.company.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
          const companyTone = [...entry.company].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4
          const urgency = entry.nextActionCompleted ? 'complete' : entry.nextActionDueDate
            ? entry.nextActionDueDate < today ? 'overdue' : entry.nextActionDueDate === today ? 'today' : 'upcoming'
            : 'none'
          const dueLabel = urgency === 'complete' ? 'Completed' : urgency === 'overdue' ? `Overdue · ${formatShortDate(entry.nextActionDueDate!)}`
            : urgency === 'today' ? 'Due today' : entry.nextActionDueDate ? `Due ${formatShortDate(entry.nextActionDueDate)}` : ''
          const statusPending = pendingStatusId === entry.id
          const rowError = statusError?.entryId === entry.id ? statusError.message : undefined
          return <tr key={entry.id} className={selectedIds?.has(entry.id) ? 'selected-row' : ''} aria-busy={statusPending || undefined}>
            {selectable && <td className="select-cell" data-label="Select"><input type="checkbox" aria-label={`Select ${entry.company} ${entry.title}`} checked={selectedIds!.has(entry.id)} disabled={selectionDisabled} onChange={(event) => selectOne(entry.id, event.target.checked)} /></td>}
            <td className="company-cell" data-label="Company"><button type="button" className="row-link strong company-link" onClick={() => onEdit(entry)}><span className={`company-mark tone-${companyTone}`} aria-hidden="true">{initials}</span><span className="company-name">{entry.company}</span></button></td>
            <td className="role-cell" data-label="Role"><button type="button" className="row-link" title={entry.title} onClick={() => onEdit(entry)}>{entry.title}</button></td>
            <td className="status-cell" data-label="Status">{onStatusChange && !compact ? <select className={`status-select status-${displayStatus}`} aria-label={`Status for ${entry.company} ${entry.title}`} value={displayStatus} disabled={selectionDisabled || statusChangesDisabled} onChange={(event) => onStatusChange(entry, event.target.value as ApplicationStatus)}>{displayStatus === 'no_response' && <option value="no_response" disabled>No response</option>}{APPLICATION_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select> : <StatusBadge status={displayStatus} />}{statusPending && <small className="row-save-status" role="status">Saving…</small>}{rowError && <p className="field-error row-status-error" role="alert">{rowError}</p>}</td>
            <td className="submitted-cell" data-label="Submitted"><time dateTime={entry.submittedDate}>{formatShortDate(entry.submittedDate)}</time></td>
            {columns.includes('effort') && <td className="effort-cell" data-label="Effort"><span className={`effort-label ${entry.effort}`}>{entry.effort === 'quick' ? 'Quick' : 'Targeted'}</span></td>}
            {columns.includes('source') && <td className="source-cell" data-label="Source">{entry.source ?? '—'}</td>}
            {columns.includes('resumeVariant') && <td className="resume-cell" data-label="Resume">{entry.resumeVariant ?? '—'}</td>}
            {columns.includes('nextAction') && <td className={`next-action-cell action-${urgency}`} data-label="Next action">{entry.nextAction ? <><span className={entry.nextActionCompleted ? 'completed' : ''}>{entry.nextAction}</span>{dueLabel && <small className="action-due">{(urgency === 'overdue' || urgency === 'today') && <Clock3 size={12} aria-hidden="true" />}<span>{dueLabel}</span></small>}</> : '—'}</td>}
            {columns.includes('daysSinceUpdate') && <td className="updated-cell" data-label="Days since update">{daysSinceUpdate(entry, today)}</td>}
            <td className="row-actions" data-label="Actions">
              {entry.url && <a href={entry.url} target="_blank" rel="noreferrer" aria-label={`Open ${entry.company} job listing`}><ExternalLink size={16} /></a>}
              <button type="button" className="icon-button" onClick={() => onEdit(entry)} aria-label={`Edit ${entry.company} ${entry.title}`}><MoreHorizontal size={19} /></button>
            </td>
          </tr>
        })}</tbody>
      </table>
    </div>
  )
}
