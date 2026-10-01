import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUpRight, Search, X } from 'lucide-react'
import { getDisplayStatus } from '../domain/status'
import type { ApplicationEntry } from '../domain/types'
import { StatusBadge } from './StatusBadge'

export interface WorkspaceAction { id: string; label: string; detail: string; icon: ReactNode; run: () => void }

export function CommandMenu({ entries, actions, onEdit, onSearchApplications, onClose }: {
  entries: ApplicationEntry[]
  actions: WorkspaceAction[]
  onEdit: (entry: ApplicationEntry) => void
  onSearchApplications: (query: string) => void
  onClose: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const commands = actions.filter((action) => !needle || `${action.label} ${action.detail}`.toLowerCase().includes(needle))
      .map((action) => ({ id: action.id, label: action.label, detail: action.detail, icon: action.icon, run: action.run, entry: undefined as ApplicationEntry | undefined }))
    const matchingEntries = entries.filter((entry) => !needle || [entry.company, entry.title, entry.notes, entry.nextAction].filter(Boolean).join(' ').toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const matches = matchingEntries.slice(0, 6)
      .map((entry) => ({ id: entry.id, label: entry.company, detail: entry.title, icon: <span className="company-mark">{entry.company.slice(0, 2).toUpperCase()}</span>, run: () => onEdit(entry), entry }))
    const more = needle && matchingEntries.length > 6 ? [{ id: 'all-matches', label: `View all ${matchingEntries.length} matches`, detail: 'Open in Applications', icon: <Search size={19} />, run: () => onSearchApplications(query.trim()), entry: undefined }] : []
    return [...commands, ...matches, ...more]
  }, [query, entries, actions, onEdit, onSearchApplications])
  const activeIndex = Math.min(index, Math.max(0, results.length - 1))

  useLayoutEffect(() => {
    dialogRef.current?.querySelector('[role="option"][aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, query])

  useLayoutEffect(() => {
    const trigger = returnFocus.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()
    return () => { document.body.style.overflow = previousOverflow; trigger?.focus() }
  }, [])

  function choose(result: typeof results[number]) {
    // A drawer opened in the same render must capture a trigger that survives the menu.
    returnFocus.current?.focus()
    onClose()
    result.run()
  }

  function handleKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex(results.length ? (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0)
    }
    if (event.key === 'Enter' && event.target === inputRef.current && results[activeIndex]) {
      event.preventDefault(); choose(results[activeIndex])
    }
    if (event.key === 'Tab') {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not([tabindex="-1"])') ?? [])]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }

  return <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="command-dialog" ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search workspace" onKeyDown={handleKey}>
      <div className="command-input"><Search size={21} /><input ref={inputRef} role="combobox" aria-label="Find an application or action" aria-expanded="true" aria-controls="workspace-results" aria-autocomplete="list" aria-activedescendant={results.length ? `command-${results[activeIndex].id}` : undefined} placeholder="Find a company, role, or action…" value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0) }} /><button className="icon-button" onClick={onClose} aria-label="Close workspace search"><X size={19} /></button></div>
      <div className="command-results" id="workspace-results" role="listbox" aria-label="Workspace results">
        {results.map((result, position) => <button type="button" role="option" tabIndex={-1} id={`command-${result.id}`} aria-selected={position === activeIndex} className={position === activeIndex ? 'active' : ''} key={result.id} onClick={() => choose(result)}><span className="command-icon">{result.icon}</span><span className="command-result-copy"><strong>{result.label}</strong><small>{result.detail}</small></span>{result.entry ? <StatusBadge status={getDisplayStatus(result.entry)} /> : <ArrowUpRight size={16} />}</button>)}
        {!results.length && <div className="empty-state"><strong>No results for “{query}”</strong><span>Try a company name, role, or “add”.</span></div>}
      </div>
      <footer className="command-footer"><span><kbd>↑</kbd><kbd>↓</kbd> to navigate <kbd>↵</kbd> to open</span><span><kbd>esc</kbd> to close</span></footer>
    </section>
  </div>
}
