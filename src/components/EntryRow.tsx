import { ExternalLink, MoreHorizontal } from 'lucide-react'
import type { ApplicationEntry } from '../domain/types'

interface EntryRowProps {
  entry: ApplicationEntry
  onEdit?: (entry: ApplicationEntry) => void
  compact?: boolean
}

export function EntryRow({ entry, onEdit, compact = false }: EntryRowProps) {
  const isBatch = entry.quantity > 1
  const label = isBatch
    ? `${entry.quantity} applications`
    : entry.company || entry.title || 'Application'
  const detail = isBatch
    ? `${capitalize(entry.type)} batch${entry.source ? ` via ${entry.source}` : ''}`
    : [entry.title, entry.company && entry.title ? entry.company : null, entry.source]
        .filter(Boolean)
        .join(' · ') || `${capitalize(entry.type)} application`

  return (
    <article className={`entry-row${compact ? ' compact' : ''}`}>
      <div className={`entry-type-dot ${entry.type}`} aria-label={`${entry.type} application`} />
      <div className="entry-main">
        <div className="entry-title-line">
          <strong>{label}</strong>
          {entry.outcome && <span className={`outcome-badge ${entry.outcome}`}>{outcomeLabel(entry.outcome)}</span>}
        </div>
        <span>{detail}</span>
      </div>
      <time dateTime={entry.submittedAt}>
        {new Date(entry.submittedAt).toLocaleDateString(undefined, {
          month: 'short', day: 'numeric',
        })}
      </time>
      {entry.url && (
        <a href={entry.url} target="_blank" rel="noreferrer" aria-label="Open job listing">
          <ExternalLink size={17} />
        </a>
      )}
      {onEdit && (
        <button type="button" className="icon-button" onClick={() => onEdit(entry)} aria-label="Edit entry">
          <MoreHorizontal size={20} />
        </button>
      )}
    </article>
  )
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function outcomeLabel(value: string) {
  return value.replace('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}
