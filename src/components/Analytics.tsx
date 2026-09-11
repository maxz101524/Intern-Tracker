import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildWeeklySeries, getEffortPerformance, getOutcomeMetrics, getPipelineSummary, getSourcePerformance } from '../domain/analytics'
import { statusLabel, todayDate } from '../domain/status'
import type { ApplicationEntry, ApplicationFilterState, DisplayStatus } from '../domain/types'

const pipelineOrder: DisplayStatus[] = ['applied', 'no_response', 'online_assessment', 'recruiter_screen', 'interview', 'offer', 'rejected', 'withdrawn']
type RangePreset = 'all' | '30' | '90' | 'year' | 'custom'

export function Analytics({ entries, onOpenApplications }: {
  entries: ApplicationEntry[]
  onOpenApplications: (filters: Partial<ApplicationFilterState>) => void
}) {
  const now = new Date()
  const today = todayDate(now)
  const [range, setRange] = useState<RangePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState(today)
  const dates = rangeDates(range, now, customFrom, customTo)
  const rangedEntries = useMemo(() => entries.filter((entry) =>
    (!dates.from || entry.submittedDate >= dates.from) && (!dates.to || entry.submittedDate <= dates.to),
  ), [dates.from, dates.to, entries])
  const metrics = getOutcomeMetrics(rangedEntries, today)
  const weekly = buildWeeklySeries(rangedEntries, now)
  const pipeline = getPipelineSummary(rangedEntries, today)
  const effort = getEffortPerformance(rangedEntries)
  const sources = getSourcePerformance(rangedEntries).sort((a, b) => b.total - a.total)
  const maxWeek = Math.max(1, ...weekly.map(({ total }) => total))
  const maxPipeline = Math.max(1, ...Object.values(pipeline))
  const rangeFilters = { fromDate: dates.from, toDate: dates.to }

  return (
    <div className="page-content analytics-page">
      <header className="page-header analytics-header"><div><p className="context-label">Patterns, with context</p><h1>Analytics</h1><p>Responses, real progression, and rejection are intentionally separate.</p></div><label>Submission range<select value={range} onChange={(event) => setRange(event.target.value as RangePreset)}><option value="all">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="year">This year</option><option value="custom">Custom range</option></select></label></header>
      {range === 'custom' && <div className="analytics-date-range"><label>From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label><label>To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label></div>}

      <section className="health-strip analytics-health interactive-metrics">
        <MetricButton label="Applications" count={metrics.total} detail="in selected range" onClick={() => onOpenApplications(rangeFilters)} />
        <MetricButton label="Any response" count={metrics.anyResponse} rate={metrics.anyResponseRate} onClick={() => onOpenApplications({ ...rangeFilters, metric: 'any_response' })} />
        <MetricButton label="Progressed" count={metrics.progressed} rate={metrics.progressedRate} onClick={() => onOpenApplications({ ...rangeFilters, metric: 'progressed' })} />
        <MetricButton label="Rejected" count={metrics.rejected} rate={metrics.rejectedRate} onClick={() => onOpenApplications({ ...rangeFilters, metric: 'rejected' })} />
      </section>
      {metrics.total > 0 && metrics.total < 20 && <p className="sample-warning"><Info size={16} /> Small sample: percentages can move sharply with each new outcome.</p>}
      <p className="analytics-context">Recent applications have had less time to receive responses. Date ranges use submission date across every metric and table below.</p>

      <section className="metric-definitions" aria-label="Metric definitions">
        <p><strong>Any response</strong> includes any employer outcome, including rejection.</p>
        <p><strong>Progressed</strong> means the application reached an assessment, recruiter screen, interview, or offer.</p>
        <p><strong>Rejected</strong> counts applications whose current status is Rejected.</p>
      </section>

      <div className="analytics-grid">
        <section className="panel weekly-panel"><div className="section-heading"><div><h2>Eight-week volume</h2><p>Only submissions inside the selected range.</p></div></div><div className="weekly-chart" role="img" aria-label="Application volume for the last eight weeks">{weekly.map((week) => <div key={week.label}><span>{week.total || ''}</span><i style={{ height: `${Math.max(3, week.total / maxWeek * 100)}%` }} /><b>{week.label}</b></div>)}</div></section>
        <section className="panel distribution-panel"><div className="section-heading"><div><h2>Pipeline distribution</h2><p>Select a row to open that filtered ledger.</p></div></div><div className="distribution-list">{pipelineOrder.map((status) => <button type="button" key={status} onClick={() => onOpenApplications({ ...rangeFilters, status })}><span>{statusLabel(status)}</span><i><b className={`status-${status}`} style={{ width: `${pipeline[status] / maxPipeline * 100}%` }} /></i><strong>{pipeline[status]}</strong></button>)}</div></section>
      </div>

      <PerformanceSection title="Effort comparison" description="Counts and rates by the time invested." rows={effort.map((row) => ({ ...row, name: row.effort === 'quick' ? 'Quick' : 'Targeted' }))} />
      <PerformanceSection title="Source performance" description="Counts and rates by application channel." rows={sources.map((row) => ({ ...row, name: row.source }))} empty="No source data yet." />
    </div>
  )
}

function PerformanceSection({ title, description, rows, empty }: {
  title: string
  description: string
  rows: Array<{ name: string; total: number; responses: number; responseRate: number; progressed: number; progressedRate: number; rejected: number; rejectedRate: number }>
  empty?: string
}) {
  return <section className="panel performance-section"><div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div></div>{rows.length ? <div className="performance-table clearer"><div className="performance-head"><span>{title.startsWith('Effort') ? 'Effort' : 'Source'}</span><span>Applications</span><span>Any response</span><span>Progressed</span><span>Rejected</span></div>{rows.map((row) => <div className="performance-row" key={row.name}><strong>{row.name}</strong><span>{row.total}</span><span>{row.responses} <small>{row.responseRate}%</small></span><span>{row.progressed} <small>{row.progressedRate}%</small></span><span>{row.rejected} <small>{row.rejectedRate}%</small></span></div>)}</div> : <div className="empty-state"><strong>{empty ?? 'No data in this range.'}</strong><span>Adjust the submission range to compare results.</span></div>}</section>
}

function MetricButton({ label, count, rate, detail, onClick }: { label: string; count: number; rate?: number; detail?: string; onClick: () => void }) {
  return <button type="button" className="metric" onClick={onClick}><span>{label}</span><strong>{count}</strong><small>{detail ?? `${rate}% of applications`}</small></button>
}

function rangeDates(range: RangePreset, now: Date, customFrom: string, customTo: string) {
  if (range === 'all') return { from: '', to: '' }
  if (range === 'custom') return { from: customFrom, to: customTo }
  if (range === 'year') return { from: `${now.getFullYear()}-01-01`, to: todayDate(now) }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(range) + 1)
  return { from: todayDate(start), to: todayDate(now) }
}
