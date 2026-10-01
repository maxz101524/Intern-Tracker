import { Bookmark, Check, Columns3, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { APPLICATION_STATUSES, appendStatus, statusLabel, todayDate } from '../domain/status'
import type {
  ApplicationColumn,
  ApplicationEffort,
  ApplicationEntry,
  ApplicationFilterState,
  ApplicationStatus,
  AppSettings,
  DisplayStatus,
  SavedApplicationView,
} from '../domain/types'
import { activeFilterLabels, EMPTY_FILTERS, filterApplications } from '../domain/views'
import { ApplicationTable } from './ApplicationTable'

export interface ApplicationViewCommand {
  id: number
  filters: Partial<ApplicationFilterState>
}

interface ApplicationsProps {
  entries: ApplicationEntry[]
  settings: AppSettings
  viewCommand?: ApplicationViewCommand
  onAdd: () => void
  onEdit: (entry: ApplicationEntry) => void
  onUpdateEntries: (next: ApplicationEntry[], previous: ApplicationEntry[], message: string) => Promise<void>
  onSaveSettings: (settings: AppSettings) => Promise<void>
}

const displayStatuses: DisplayStatus[] = [
  'applied', 'no_response', 'online_assessment', 'recruiter_screen',
  'interview', 'offer', 'rejected', 'withdrawn',
]
const columnOptions: Array<{ value: ApplicationColumn; label: string }> = [
  { value: 'effort', label: 'Effort' }, { value: 'source', label: 'Source' },
  { value: 'resumeVariant', label: 'Resume variant' }, { value: 'nextAction', label: 'Next action' },
  { value: 'daysSinceUpdate', label: 'Days since update' },
]

export function Applications({
  entries,
  settings,
  viewCommand,
  onAdd,
  onEdit,
  onUpdateEntries,
  onSaveSettings,
}: ApplicationsProps) {
  const [filters, setFilters] = useState<ApplicationFilterState>(EMPTY_FILTERS)
  const [sort, setSort] = useState<'submitted' | 'company' | 'updated' | 'due'>('submitted')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewName, setViewName] = useState('')
  const [editingViewId, setEditingViewId] = useState('')
  const [showSaveView, setShowSaveView] = useState(false)
  const [isBulkUpdating, setIsBulkUpdating] = useState(false)
  const [bulkError, setBulkError] = useState('')
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<{ entryId: string; message: string } | null>(null)
  const bulkUpdating = useRef(false)
  const statusUpdating = useRef(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const today = todayDate()
  const sources = settings.sources
  const savedViews = settings.savedViews ?? []
  const visibleColumns = settings.visibleColumns ?? ['effort', 'source']

  useEffect(() => {
    if (!viewCommand) return
    setFilters({ ...EMPTY_FILTERS, ...viewCommand.filters })
    setSelectedIds(new Set())
    setEditingViewId('')
    setBulkError('')
    setStatusError(null)
  }, [viewCommand])

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey ||
        target?.matches('input, textarea, select, [contenteditable="true"]') || searchInput.current?.closest('[hidden]') || document.querySelector('[role="dialog"]')) return
      event.preventDefault()
      searchInput.current?.focus()
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const filtered = useMemo(() => {
    const matches = filterApplications(entries, filters, today)
    return [...matches].sort((left, right) => {
      if (sort === 'company') return left.company.localeCompare(right.company) || left.title.localeCompare(right.title)
      if (sort === 'updated') return right.updatedAt.localeCompare(left.updatedAt)
      if (sort === 'due') return (left.nextActionDueDate ?? '9999').localeCompare(right.nextActionDueDate ?? '9999') || left.company.localeCompare(right.company)
      return right.submittedDate.localeCompare(left.submittedDate) || right.updatedAt.localeCompare(left.updatedAt)
    })
  }, [entries, filters, sort, today])

  const labels = activeFilterLabels(filters)
  const filterKeys: Array<keyof ApplicationFilterState> = []
  if (filters.preset) filterKeys.push('preset')
  if (filters.metric) filterKeys.push('metric')
  if (filters.status !== 'all') filterKeys.push('status')
  if (filters.effort !== 'all') filterKeys.push('effort')
  if (filters.source !== 'all') filterKeys.push('source')
  if (filters.fromDate || filters.toDate) filterKeys.push('fromDate')
  if (filters.query) filterKeys.push('query')

  // Derive the selection from the current results before any bulk action can run.
  const selected = filtered.filter((entry) => selectedIds.has(entry.id))
  const visibleSelectedIds = new Set(selected.map((entry) => entry.id))

  useEffect(() => {
    const visibleIds = new Set(filtered.map((entry) => entry.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [filtered])

  function changeFilters(patch: Partial<ApplicationFilterState>, manual = true) {
    setFilters((current) => ({ ...current, ...(manual ? { metric: undefined, preset: undefined } : {}), ...patch }))
    setEditingViewId('')
    setSelectedIds(new Set())
    setBulkError('')
    setStatusError(null)
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setEditingViewId('')
    setSelectedIds(new Set())
    setBulkError('')
    setStatusError(null)
  }

  function applyPreset(preset: NonNullable<ApplicationFilterState['preset']>) {
    setFilters(filters.preset === preset ? EMPTY_FILTERS : { ...EMPTY_FILTERS, preset })
    setEditingViewId('')
    setSelectedIds(new Set())
    setBulkError('')
    setStatusError(null)
  }

  function removeFilter(key: keyof ApplicationFilterState) {
    const patch = key === 'fromDate'
      ? { fromDate: '', toDate: '' }
      : { [key]: key in EMPTY_FILTERS ? EMPTY_FILTERS[key as keyof typeof EMPTY_FILTERS] : undefined }
    changeFilters(patch, false)
  }

  async function updateStatus(entry: ApplicationEntry, status: ApplicationStatus) {
    if (statusUpdating.current || bulkUpdating.current) return
    statusUpdating.current = true
    setStatusError(null)
    setBulkError('')
    try {
      const next = appendStatus(entry, status, today)
      if (next === entry) return
      setPendingStatusId(entry.id)
      await onUpdateEntries([next], [entry], `Status updated to ${statusLabel(status)}`)
    } catch (error) {
      setStatusError({ entryId: entry.id, message: error instanceof Error ? error.message : 'Status could not be saved. Try again.' })
    } finally {
      statusUpdating.current = false
      setPendingStatusId(null)
    }
  }

  async function bulkUpdate(kind: 'status' | 'source' | 'effort', value: string) {
    if (!value || selected.length === 0 || bulkUpdating.current || statusUpdating.current) return
    bulkUpdating.current = true
    setIsBulkUpdating(true)
    setBulkError('')
    setStatusError(null)
    try {
      const now = new Date().toISOString()
      const next = selected.map((entry) => {
        if (kind === 'status') return appendStatus(entry, value as ApplicationStatus, today)
        if (kind === 'source') {
          const source = value === '__none' ? undefined : value
          return entry.source === source ? entry : { ...entry, source, updatedAt: now }
        }
        if (entry.effort === value) return entry
        return { ...entry, effort: value as ApplicationEffort, updatedAt: now }
      })
      const changed = next.filter((entry, index) => entry !== selected[index])
      if (changed.length > 0) {
        const changedIds = new Set(changed.map((entry) => entry.id))
        const previous = selected.filter((entry) => changedIds.has(entry.id))
        await onUpdateEntries(changed, previous, `${changed.length} ${changed.length === 1 ? 'application' : 'applications'} updated`)
      }
      setSelectedIds(new Set())
    } catch (error) {
      setBulkError(error instanceof Error ? error.message : 'Applications could not be updated. Try again.')
    } finally {
      bulkUpdating.current = false
      setIsBulkUpdating(false)
    }
  }

  async function setColumns(column: ApplicationColumn, checked: boolean) {
    const next = checked ? [...visibleColumns, column] : visibleColumns.filter((item) => item !== column)
    await onSaveSettings({ ...settings, visibleColumns: [...new Set(next)] })
  }

  async function saveView() {
    const name = viewName.trim()
    if (!name) return
    const existing = savedViews.find((view) => view.id === editingViewId)
    const nextView: SavedApplicationView = { id: existing?.id ?? crypto.randomUUID(), name, filters: { ...filters } }
    const nextViews = existing
      ? savedViews.map((view) => view.id === existing.id ? nextView : view)
      : [...savedViews, nextView]
    await onSaveSettings({ ...settings, savedViews: nextViews })
    setEditingViewId(nextView.id)
    setViewName('')
    setShowSaveView(false)
  }

  function applySavedView(id: string) {
    const view = savedViews.find((item) => item.id === id)
    if (!view) { clearFilters(); return }
    setFilters({ ...EMPTY_FILTERS, ...view.filters })
    setEditingViewId(id)
    setSelectedIds(new Set())
    setBulkError('')
    setStatusError(null)
  }

  function beginRename() {
    const view = savedViews.find((item) => item.id === editingViewId)
    if (view) { setViewName(view.name); setShowSaveView(true) }
  }

  return (
    <div className="page-content applications-page">
      <header className="page-header action-header">
        <div><p className="context-label">Every opportunity, in order</p><h1>Applications</h1><p>A clear view of where you stand and what comes next.</p></div>
        <button type="button" className="button primary" aria-label="Add application" onClick={onAdd}><Plus size={17} /> Add application <kbd aria-hidden="true">N</kbd></button>
      </header>

      <div className="preset-bar" aria-label="Preset application views">
        <button type="button" className={labels.length === 0 ? 'active' : ''} aria-pressed={labels.length === 0} onClick={clearFilters}>All applications</button>
        {(['in_progress', 'this_week', 'awaiting_response'] as const).map((preset) => <button key={preset} type="button" className={filters.preset === preset ? 'active' : ''} aria-pressed={filters.preset === preset} onClick={() => applyPreset(preset)}>{preset === 'in_progress' ? 'In progress' : preset === 'this_week' ? 'This week' : 'Awaiting response'}</button>)}
        <span />
        <label className="saved-view-select"><Bookmark size={15} /><select aria-label="Saved views" value={editingViewId} onChange={(event) => applySavedView(event.target.value)}><option value="">Saved views</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
        {editingViewId && <button type="button" className="text-button" onClick={beginRename}>Rename</button>}
        <details className="save-view-menu" open={showSaveView}><summary className="text-button" onClick={(event) => { event.preventDefault(); setShowSaveView((visible) => !visible); if (!showSaveView) setViewName(savedViews.find((view) => view.id === editingViewId)?.name ?? '') }}>{editingViewId ? 'Update view' : 'Save view'}</summary>{showSaveView && <div><input aria-label="View name" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="View name" /><button type="button" className="button primary" onClick={saveView}><Check size={15} /> Save</button></div>}</details>
      </div>

      <section className="filter-panel" aria-label="Application filters">
        <label className="search-field"><span className="sr-only">Search applications</span><Search size={17} /><input ref={searchInput} type="search" aria-label="Search applications" aria-keyshortcuts="/" value={filters.query} onChange={(event) => changeFilters({ query: event.target.value }, false)} placeholder="Search company, role, notes…" />{!filters.query && <kbd className="search-shortcut" aria-hidden="true">/</kbd>}{filters.query && <button type="button" className="search-clear" aria-label="Clear search" onClick={() => changeFilters({ query: '' }, false)}><X size={15} /></button>}</label>
        <label><span className="sr-only">Status</span><select value={filters.status} onChange={(event) => changeFilters({ status: event.target.value as DisplayStatus | 'all' })}><option value="all">All statuses</option>{displayStatuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        <label><span className="sr-only">Effort</span><select value={filters.effort} onChange={(event) => changeFilters({ effort: event.target.value as ApplicationEffort | 'all' })}><option value="all">All effort</option><option value="quick">Quick</option><option value="targeted">Targeted</option></select></label>
        <label><span className="sr-only">Source</span><select value={filters.source} onChange={(event) => changeFilters({ source: event.target.value })}><option value="all">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
        <details className="date-filter"><summary><SlidersHorizontal size={16} /> Dates</summary><div><label>From<input type="date" value={filters.fromDate} onChange={(event) => changeFilters({ fromDate: event.target.value })} /></label><label>To<input type="date" value={filters.toDate} onChange={(event) => changeFilters({ toDate: event.target.value })} /></label></div></details>
        {labels.length > 0 && <button type="button" className="clear-button" onClick={clearFilters}><X size={15} /> Clear</button>}
      </section>

      {labels.length > 0 && <div className="active-filters" aria-label="Active filters"><strong>Showing</strong>{labels.map((label, index) => <button type="button" className="filter-chip" key={filterKeys[index]} onClick={() => removeFilter(filterKeys[index])} aria-label={`Remove ${label} filter`}><span>{label}</span><X size={12} aria-hidden="true" /></button>)}</div>}

      <div className="ledger-tools">
        <div className="ledger-summary" role="status" aria-live="polite" aria-atomic="true"><span><strong>{filtered.length}</strong> {filtered.length === 1 ? 'opportunity' : 'opportunities'} shown</span><span>{entries.length} total applications</span></div>
        <label>Sort <select aria-label="Sort applications" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="submitted">Submitted date</option><option value="company">Company</option><option value="updated">Last update</option><option value="due">Next-action due date</option></select></label>
        <details className="columns-menu"><summary><Columns3 size={16} /> Columns</summary><div>{columnOptions.map((column) => <label key={column.value}><input type="checkbox" checked={visibleColumns.includes(column.value)} onChange={(event) => void setColumns(column.value, event.target.checked)} />{column.label}</label>)}</div></details>
      </div>

      {selected.length > 0 && <div className="bulk-bar" role="region" aria-label="Bulk update applications"><strong>{isBulkUpdating ? 'Updating…' : `${selected.length} selected`}</strong><label>Status<select defaultValue="" disabled={isBulkUpdating || pendingStatusId !== null} onChange={(event) => { void bulkUpdate('status', event.target.value); event.target.value = '' }}><option value="" disabled>Change…</option>{APPLICATION_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label>Source<select defaultValue="" disabled={isBulkUpdating || pendingStatusId !== null} onChange={(event) => { void bulkUpdate('source', event.target.value); event.target.value = '' }}><option value="" disabled>Change…</option><option value="__none">Not specified</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></label><label>Effort<select defaultValue="" disabled={isBulkUpdating || pendingStatusId !== null} onChange={(event) => { void bulkUpdate('effort', event.target.value); event.target.value = '' }}><option value="" disabled>Change…</option><option value="quick">Quick</option><option value="targeted">Targeted</option></select></label><button type="button" className="icon-button" disabled={isBulkUpdating} onClick={() => setSelectedIds(new Set())} aria-label="Clear selection"><X size={17} /></button></div>}

      {bulkError && <p className="inline-error" role="alert">{bulkError}</p>}
      <ApplicationTable
        entries={filtered}
        onEdit={onEdit}
        onStatusChange={updateStatus}
        visibleColumns={visibleColumns}
        selectedIds={visibleSelectedIds}
        onSelectionChange={setSelectedIds}
        selectionDisabled={isBulkUpdating}
        statusChangesDisabled={pendingStatusId !== null}
        pendingStatusId={pendingStatusId}
        statusError={statusError}
        emptyMessage={entries.length === 0 ? 'Your next opportunity starts here.' : 'No opportunities match this view.'}
        emptyDescription={entries.length === 0 ? 'Add your first application. Keep the details, progress and next step together.' : 'Try another company or role, or clear the filters to see your full search.'}
        emptyAction={{ label: entries.length === 0 ? 'Add your first application' : 'Clear filters', onClick: entries.length === 0 ? onAdd : clearFilters }}
      />
    </div>
  )
}
