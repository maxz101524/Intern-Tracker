import { buildWeeklySeries, getEffortPerformance, getOutcomeMetrics, getPipelineSummary, getSourcePerformance } from '../domain/analytics'
import { statusLabel, todayDate } from '../domain/status'
import type { ApplicationEntry, DisplayStatus } from '../domain/types'

const pipelineOrder: DisplayStatus[] = ['applied', 'no_response', 'online_assessment', 'recruiter_screen', 'interview', 'offer', 'rejected', 'withdrawn']

export function Analytics({ entries }: { entries: ApplicationEntry[] }) {
  const now = new Date()
  const metrics = getOutcomeMetrics(entries, todayDate(now))
  const weekly = buildWeeklySeries(entries, now)
  const pipeline = getPipelineSummary(entries, todayDate(now))
  const effort = getEffortPerformance(entries)
  const sources = getSourcePerformance(entries).sort((a, b) => b.total - a.total)
  const maxWeek = Math.max(1, ...weekly.map(({ total }) => total))
  const maxPipeline = Math.max(1, ...Object.values(pipeline))

  return (
    <div className="page-content analytics-page">
      <header className="page-header"><div><p className="context-label">Patterns, not scores</p><h1>Analytics</h1><p>See which effort and channels are actually moving applications forward.</p></div></header>
      <section className="health-strip analytics-health"><Metric label="Applications" value={metrics.total} /><Metric label="Responses" value={metrics.responses} suffix={`${metrics.responseRate}% rate`} /><Metric label="Interviews" value={metrics.interviews} suffix={`${metrics.interviewRate}% rate`} /><Metric label="Offers" value={metrics.offers} /></section>

      <div className="analytics-grid">
        <section className="panel weekly-panel"><div className="section-heading"><div><h2>Eight-week volume</h2><p>Singular roles submitted each week.</p></div></div><div className="weekly-chart" role="img" aria-label="Application volume for the last eight weeks">{weekly.map((week) => <div key={week.label}><span>{week.total || ''}</span><i style={{ height: `${Math.max(3, week.total / maxWeek * 100)}%` }} /><b>{week.label}</b></div>)}</div></section>
        <section className="panel distribution-panel"><div className="section-heading"><div><h2>Pipeline distribution</h2><p>Current status, including automatic No response.</p></div></div><div className="distribution-list">{pipelineOrder.map((status) => <div key={status}><span>{statusLabel(status)}</span><i><b className={`status-${status}`} style={{ width: `${pipeline[status] / maxPipeline * 100}%` }} /></i><strong>{pipeline[status]}</strong></div>)}</div></section>
      </div>

      <section className="panel performance-section"><div className="section-heading"><div><h2>Effort comparison</h2><p>Does tailoring improve the outcomes that matter?</p></div></div><div className="performance-table"><div className="performance-head"><span>Effort</span><span>Applications</span><span>Responses</span><span>Response rate</span><span>Interviews</span><span>Interview rate</span></div>{effort.map((row) => <div className="performance-row" key={row.effort}><strong>{row.effort === 'quick' ? 'Quick' : 'Targeted'}</strong><span>{row.total}</span><span>{row.responses}</span><span>{row.responseRate}%</span><span>{row.interviews}</span><span>{row.interviewRate}%</span></div>)}</div></section>

      <section className="panel performance-section"><div className="section-heading"><div><h2>Source performance</h2><p>Volume and progression by application channel.</p></div></div>{sources.length ? <div className="performance-table source-performance"><div className="performance-head"><span>Source</span><span>Applications</span><span>Responses</span><span>Response rate</span><span>Interviews</span><span>Interview rate</span></div>{sources.map((row) => <div className="performance-row" key={row.source}><strong>{row.source}</strong><span>{row.total}</span><span>{row.responses}</span><span>{row.responseRate}%</span><span>{row.interviews}</span><span>{row.interviewRate}%</span></div>)}</div> : <div className="empty-state"><strong>No source data yet.</strong><span>Add applications to compare channels.</span></div>}</section>
    </div>
  )
}

function Metric({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{suffix && <small>{suffix}</small>}</div>
}
