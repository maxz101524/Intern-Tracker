import { Bookmark, Check, Columns3, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
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
  const today = todayDate()
  const sources = settings.sources
  const savedViews = settings.savedViews ?? []
  const visibleColumns = settings.visibleColumns ?? ['effort', 'source']

  useEffect(() => {
    if (!viewCommand) return
    setFilters({ ...EMPTY_FILTERS, ...viewCommand.filters })
    setSelectedIds(new Set())
  }, [viewCommand])

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
  const selected = entries.filter((entry) => selectedIds.has(entry.id))

  function changeFilters(patch: Partial<ApplicationFilterState>, manual = true) {
    setFilters((current) => ({ ...current, ...(manual ? { metric: undefined, preset: undefined } : {}), ...patch }))
    setEditingViewId('')
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS)
    setEditingViewId('')
  }

  async function updateStatus(entry: ApplicationEntry, status: ApplicationStatus) {
    const next = appendStatus(entry, status, today)
    if (next === entry) return
    await onUpdateEntries([next], [entry], `Status updated to ${statusLabel(status)}`)
  }

  async function bulkUpdate(kind: 'status' | 'source' | 'effort', value: string) {
    if (!value || selected.length === 0) return
    const now = new Date().toISOString()
    const next = selected.map((entry) => {
      if (kind === 'status') return appendStatus(entry, value as ApplicationStatus, today)
      if (kind === 'source') return { ...entry, source: value === '__none' ? undefined : value, updatedAt: now }
      return { ...entry, effort: value as ApplicationEffort, updatedAt: now }
    })
    await onUpdateEntries(next, selected, `${selected.length} applications updated`)
    setSelectedIds(new Set())
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
  }

  function beginRename() {
    const view = savedViews.find((item) => item.id === editingViewId)
    if (view) { setViewName(view.name); setShowSaveView(true) }
  }

  return (
    <div className="page-content applications-page">
      <header className="page-header action-header">
        <div><p className="context-label">Every role, one record</p><h1>Applications</h1><p>Use presets for common checks, or shape the ledger around the work at hand.</p></div>
        <button type="button" className="button primary" aria-label="Add application" onClick={onAdd}><Plus size={17} /> Add application <kbd aria-hidden="true">N</kbd></button>
      </header>

      <div className="preset-bar" aria-label="Preset application views">
        {(['in_progress', 'this_week', 'awaiting_response'] as const).map((preset) => <button key={preset} type="button" className={filters.preset === preset ? 'active' : ''} onClick={() => setFilters({ ...EMPTY_FILTERS, preset })}>{preset === 'in_progress' ? 'In progress' : preset === 'this_week' ? 'This week' : 'Awaiting response'}</button>)}
        <span />
        <label className="saved-view-select"><Bookmark size={15} /><select aria-label="Saved views" value={editingViewId} onChange={(event) => applySavedView(event.target.value)}><option value="">Saved views</option>{savedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select></label>
        {editingViewId && <button type="button" className="text-button" onClick={beginRename}>Rename</button>}
        <details className="save-view-menu" open={showSaveView}><summary className="text-button" onClick={(event) => { event.preventDefault(); setShowSaveView((visible) => !visible); if (!showSaveView) setViewName(savedViews.find((view) => view.id === editingViewId)?.name ?? '') }}>{editingViewId ? 'Update view' : 'Save view'}</summary>{showSaveView && <div><input aria-label="View name" value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="View name" /><button type="button" className="button primary" onClick={saveView}><Check size={15} /> Save</button></div>}</details>
      </div>

      <section className="filter-panel" aria-label="Application filters">
        <label className="search-field"><span className="sr-only">Search applications</span><Search size={17} /><input value={filters.query} onChange={(event) => changeFilters({ query: event.target.value }, false)} placeholder="Search company, role, notes…" /></label>
        <label><span className="sr-only">Status</span><select value={filters.status} onChange={(event) => changeFilters({ status: event.target.value as DisplayStatus | 'all' })}><option value="all">All statuses</option>{displayStatuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        <label><span className="sr-only">Effort</span><select value={filters.effort} onChange={(event) => changeFilters({ effort: event.target.value as ApplicationEffort | 'all' })}><option value="all">All effort</option><option value="quick">Quick</option><option value="targeted">Targeted</option></select></label>
        <label><span className="sr-only">Source</span><select value={filters.source} onChange={(event) => changeFilters({ source: event.target.value })}><option value="all">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
        <details className="date-filter"><summary><SlidersHorizontal size={16} /> Dates</summary><div><label>From<input type="date" value={filters.fromDate} onChange={(event) => changeFilters({ fromDate: event.target.value })} /></label><label>To<input type="date" value={filters.toDate} onChange={(event) => changeFilters({ toDate: event.target.value })} /></label></div></details>
        {labels.length > 0 && <button type="button" className="clear-button" onClick={clearFilters}><X size={15} /> Clear</button>}
      </section>

      {labels.length > 0 && <div className="active-filters" aria-label="Active filters"><strong>Showing</strong>{labels.map((label) => <span key={label}>{label}</span>)}</div>}

      <div className="ledger-tools">
        <div className="ledger-summary"><span><strong>{filtered.length}</strong> shown</span><span>{entries.length} total applications</span></div>
        <label>Sort <select aria-label="Sort applications" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="submitted">Submitted date</option><option value="company">Company</option><option value="updated">Last update</option><option value="due">Next-action due date</option></select></label>
        <details className="columns-menu"><summary><Columns3 size={16} /> Columns</summary><div>{columnOptions.map((column) => <label key={column.value}><input type="checkbox" checked={visibleColumns.includes(column.value)} onChange={(event) => void setColumns(column.value, event.target.checked)} />{column.label}</label>)}</div></details>
      </div>

      {selected.length > 0 && <div className="bulk-bar" role="region" aria-label="Bulk update applications"><strong>{selected.length} selected</strong><label>Status<select defaultValue="" onChange={(event) => { void bulkUpdate('status', event.target.value); event.target.value = '' }}><option value="" disabled>Change…</option>{APPLICATION_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label><label>Source<select defaultValue="" onChange={(event) => { void bulkUpdate('source', event.target.value); event.target.value = '' }}><option value="" disabled>Change…</option><option value="__none">Not specified</option>{sources.map((source) => <option key={source}>{source}</option>)}</select></label><label>Effort<select defaultValue="" onChange={(event) => { void bulkUpdate('effort', event.target.value); event.target.value = '' }}><option value="" disabled>Change…</option><option value="quick">Quick</option><option value="targeted">Targeted</option></select></label><button type="button" className="icon-button" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection"><X size={17} /></button></div>}

      <ApplicationTable entries={filtered} onEdit={onEdit} onStatusChange={updateStatus} visibleColumns={visibleColumns} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
    </div>
  )
}
