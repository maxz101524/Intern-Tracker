import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { ApplicationEntry, ApplicationType } from '../domain/types'
import { EntryRow } from './EntryRow'

interface HistoryProps {
  entries: ApplicationEntry[]
  sources: string[]
  onEdit: (entry: ApplicationEntry) => void
}

export function History({ entries, sources, onEdit }: HistoryProps) {
  const [search, setSearch] = useState('')
  const [type, setType] = useState<ApplicationType | 'all'>('all')
  const [source, setSource] = useState('all')

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return entries.filter((entry) => {
      const searchable = [entry.company, entry.title, entry.source, entry.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return (
        (!query || searchable.includes(query)) &&
        (type === 'all' || entry.type === type) &&
        (source === 'all' || entry.source === source)
      )
    })
  }, [entries, search, source, type])

  const total = filtered.reduce((sum, entry) => sum + entry.quantity, 0)

  return (
    <div className="page-content history-page">
      <header className="page-header">
        <div><p className="context-label">Your complete ledger</p><h1>Application history</h1></div>
        <div className="history-total"><strong>{total}</strong><span>applications shown</span></div>
      </header>

      <section className="history-tools" aria-label="History filters">
        <label className="search-field">
          <Search size={18} aria-hidden="true" />
          <span className="sr-only">Search applications</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company, role, source…" />
        </label>
        <label><span className="sr-only">Application type</span><select value={type} onChange={(event) => setType(event.target.value as ApplicationType | 'all')}><option value="all">All types</option><option value="quick">Quick</option><option value="targeted">Targeted</option></select></label>
        <label><span className="sr-only">Application source</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="all">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label>
      </section>

      <section className="history-ledger" aria-label="Application entries">
        {filtered.map((entry) => <EntryRow key={entry.id} entry={entry} onEdit={onEdit} />)}
        {filtered.length === 0 && (
          <div className="empty-state large"><strong>No entries match these filters</strong><span>Try a broader search or clear a filter.</span></div>
        )}
      </section>
    </div>
  )
}
