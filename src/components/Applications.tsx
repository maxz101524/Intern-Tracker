import { Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { getDisplayStatus, statusLabel, todayDate } from '../domain/status'
import type { ApplicationEffort, ApplicationEntry, DisplayStatus } from '../domain/types'
import { ApplicationTable } from './ApplicationTable'

interface ApplicationsProps {
  entries: ApplicationEntry[]
  sources: string[]
  onAdd: () => void
  onEdit: (entry: ApplicationEntry) => void
}

const displayStatuses: DisplayStatus[] = [
  'applied', 'no_response', 'online_assessment', 'recruiter_screen',
  'interview', 'offer', 'rejected', 'withdrawn',
]

export function Applications({ entries, sources, onAdd, onEdit }: ApplicationsProps) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<DisplayStatus | 'all'>('all')
  const [effort, setEffort] = useState<ApplicationEffort | 'all'>('all')
  const [source, setSource] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const today = todayDate()

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      const searchable = [entry.company, entry.title, entry.source, entry.resumeVariant, entry.notes].filter(Boolean).join(' ').toLowerCase()
      return (!needle || searchable.includes(needle)) &&
        (status === 'all' || getDisplayStatus(entry, today) === status) &&
        (effort === 'all' || entry.effort === effort) &&
        (source === 'all' || entry.source === source) &&
        (!fromDate || entry.submittedDate >= fromDate) &&
        (!toDate || entry.submittedDate <= toDate)
    })
  }, [effort, entries, fromDate, query, source, status, toDate, today])

  const hasFilters = Boolean(query || status !== 'all' || effort !== 'all' || source !== 'all' || fromDate || toDate)
  function clearFilters() {
    setQuery(''); setStatus('all'); setEffort('all'); setSource('all'); setFromDate(''); setToDate('')
  }

  return (
    <div className="page-content applications-page">
      <header className="page-header action-header">
        <div><p className="context-label">Every role, one record</p><h1>Applications</h1><p>Search the full ledger and update outcomes as they arrive.</p></div>
        <button type="button" className="button primary" onClick={onAdd}><Plus size={17} /> Add application</button>
      </header>

      <section className="filter-panel" aria-label="Application filters">
        <label className="search-field"><span className="sr-only">Search applications</span><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search company, role, notes…" /></label>
        <label><span className="sr-only">Status</span><select value={status} onChange={(event) => setStatus(event.target.value as DisplayStatus | 'all')}><option value="all">All statuses</option>{displayStatuses.map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}</select></label>
        <label><span className="sr-only">Effort</span><select value={effort} onChange={(event) => setEffort(event.target.value as ApplicationEffort | 'all')}><option value="all">All effort</option><option value="quick">Quick</option><option value="targeted">Targeted</option></select></label>
        <label><span className="sr-only">Source</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
        <details className="date-filter"><summary><SlidersHorizontal size={16} /> Dates</summary><div><label>From<input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label><label>To<input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label></div></details>
        {hasFilters && <button type="button" className="clear-button" onClick={clearFilters}><X size={15} /> Clear</button>}
      </section>

      <div className="ledger-summary"><span><strong>{filtered.length}</strong> shown</span><span>{entries.length} total applications</span></div>
      <ApplicationTable entries={filtered} onEdit={onEdit} />
    </div>
  )
}
