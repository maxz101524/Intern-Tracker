import { useState } from 'react'
import { ChevronDown, ChevronUp, Gauge, Target } from 'lucide-react'
import type { ApplicationType, EntryInput } from '../domain/types'

interface QuickLogProps {
  sources: string[]
  onLog: (entry: EntryInput) => Promise<void>
}

function todayInputValue() {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 10)
}

export function QuickLog({ sources, onLog }: QuickLogProps) {
  const [quantity, setQuantity] = useState(1)
  const [source, setSource] = useState('')
  const [date, setDate] = useState(todayInputValue)
  const [expanded, setExpanded] = useState(false)
  const [company, setCompany] = useState('')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function log(type: ApplicationType) {
    setError('')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      setError('Quantity must be between 1 and 500.')
      return
    }
    setSaving(true)
    try {
      const submittedAt = new Date(`${date}T12:00:00`).toISOString()
      await onLog({
        submittedAt,
        quantity,
        type,
        source: source || undefined,
        ...(quantity === 1 && expanded
          ? {
              company: company || undefined,
              title: title || undefined,
              url: url || undefined,
            }
          : {}),
      })
      setQuantity(1)
      setCompany('')
      setTitle('')
      setUrl('')
      setExpanded(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The entry could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="quick-log" aria-labelledby="quick-log-heading">
      <div className="section-heading-row">
        <div>
          <h2 id="quick-log-heading">Log what you submitted</h2>
          <p>Count it now. Add context only when it matters.</p>
        </div>
        <button
          type="button"
          className="text-button"
          onClick={() => setExpanded((value) => !value)}
          disabled={quantity > 1}
        >
          {expanded ? 'Hide details' : 'Add role details'}
          {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </button>
      </div>

      <div className="quick-fields">
        <label>
          Quantity
          <input
            type="number"
            min="1"
            max="500"
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
          />
        </label>
        <label>
          Source <span className="optional">optional</span>
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            <option value="">Not specified</option>
            {sources.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          Submitted
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
      </div>

      {quantity > 1 && (
        <p className="inline-note">Batch entries stay anonymous. Split one out later if it gets a response.</p>
      )}

      {expanded && quantity === 1 && (
        <div className="detail-fields">
          <label>Company <input value={company} onChange={(event) => setCompany(event.target.value)} /></label>
          <label>Role <input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="span-two">Job URL <input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://" /></label>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="log-actions">
        <button
          type="button"
          className="log-button quick"
          onClick={() => log('quick')}
          disabled={saving}
          aria-label="Log quick application"
        >
          <Gauge size={21} aria-hidden="true" />
          <span><strong>Quick</strong><small>Easy apply or batch</small></span>
          <b>+{quantity}</b>
        </button>
        <button
          type="button"
          className="log-button targeted"
          onClick={() => log('targeted')}
          disabled={saving}
          aria-label="Log targeted application"
        >
          <Target size={21} aria-hidden="true" />
          <span><strong>Targeted</strong><small>Tailored or high-priority</small></span>
          <b>+{quantity}</b>
        </button>
      </div>
    </section>
  )
}
