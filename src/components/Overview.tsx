import { ArrowRight, CalendarDays, Plus } from 'lucide-react'
import { buildDailySeries, getOutcomeMetrics, getPipelineSummary, getWeekSummary, startOfMonday } from '../domain/analytics'
import { statusLabel, todayDate } from '../domain/status'
import type { ApplicationEntry, AppSettings, DisplayStatus } from '../domain/types'
import { ApplicationTable } from './ApplicationTable'

interface OverviewProps {
  entries: ApplicationEntry[]
  settings: AppSettings
  onAdd: () => void
  onEdit: (entry: ApplicationEntry) => void
  onOpenApplications: () => void
}

const pipelineOrder: DisplayStatus[] = ['applied', 'no_response', 'online_assessment', 'recruiter_screen', 'interview', 'offer', 'rejected']

export function Overview({ entries, settings, onAdd, onEdit, onOpenApplications }: OverviewProps) {
  const now = new Date()
  const today = todayDate(now)
  const summary = getWeekSummary(entries, settings.weeklyTarget, now)
  const metrics = getOutcomeMetrics(entries, today)
  const pipeline = getPipelineSummary(entries, today)
  const daily = buildDailySeries(entries, now)
  const maxDaily = Math.max(1, ...daily.map(({ total }) => total))
  const weekStart = startOfMonday(now)
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  const progress = settings.weeklyTarget ? Math.min(100, summary.submitted / settings.weeklyTarget * 100) : 0

  return (
    <div className="page-content overview-page">
      <header className="page-header action-header">
        <div><p className="context-label">{formatWeekRange(weekStart, weekEnd)}</p><h1>Your search, at a glance</h1><p>Keep the volume moving without losing track of individual roles.</p></div>
        <button type="button" className="button primary" onClick={onAdd}><Plus size={17} /> Add application</button>
      </header>

      <section className="pace-strip" aria-label={`${summary.submitted} of ${settings.weeklyTarget} applications`}>
        <div className="pace-primary"><span>Applications this week</span><strong>{summary.submitted}<em> / {settings.weeklyTarget}</em></strong><div className="progress-track"><i style={{ width: `${progress}%` }} /><b style={{ left: `${Math.min(100, summary.expectedByNow / settings.weeklyTarget * 100)}%` }} /></div></div>
        <Metric label="Remaining" value={summary.remaining} />
        <Metric label="Needed per day" value={summary.requiredDailyPace.toFixed(1)} />
        <div className={`pace-readout ${summary.isOnTrack ? 'on-track' : 'behind'}`}><span />{summary.isOnTrack ? 'On pace' : 'Needs a push'}<small>Expected by today: {summary.expectedByNow}</small></div>
      </section>

      <section className="health-strip" aria-label="Search outcomes">
        <Metric label="Total applications" value={metrics.total} />
        <Metric label="Active" value={metrics.active} />
        <Metric label="Responses" value={metrics.responses} suffix={`${metrics.responseRate}% rate`} />
        <Metric label="Interviews" value={metrics.interviews} suffix={`${metrics.interviewRate}% rate`} />
      </section>

      <div className="overview-grid">
        <section className="panel daily-panel"><div className="section-heading"><div><h2>Application rhythm</h2><p>Quick and Targeted submissions this week.</p></div><span className="expected-label"><CalendarDays size={15} /> Mon–Sun</span></div><div className="daily-chart" role="img" aria-label="Daily Quick and Targeted applications">{daily.map((day) => <div className="day-column" key={day.label}><span>{day.total || ''}</span><div className="day-bars"><i className="targeted" style={{ height: `${day.targeted / maxDaily * 100}%` }} /><i className="quick" style={{ height: `${day.quick / maxDaily * 100}%` }} /></div><b>{day.label.slice(0, 2)}</b></div>)}</div><div className="chart-legend"><span><i className="quick" /> Quick <strong>{summary.quick}</strong></span><span><i className="targeted" /> Targeted <strong>{summary.targeted}</strong></span></div></section>

        <section className="panel pipeline-panel"><div className="section-heading"><div><h2>Current pipeline</h2><p>Where every application stands today.</p></div></div><div className="pipeline-list">{pipelineOrder.filter((status) => pipeline[status] > 0 || ['applied', 'no_response', 'interview'].includes(status)).map((status) => <div key={status}><span className={`pipeline-dot status-${status}`} /><span>{statusLabel(status)}</span><strong>{pipeline[status]}</strong><i style={{ width: `${metrics.total ? pipeline[status] / metrics.total * 100 : 0}%` }} /></div>)}</div></section>
      </div>

      <section className="panel recent-section"><div className="section-heading"><div><h2>Recent applications</h2><p>The latest roles added to your ledger.</p></div><button type="button" className="text-button" onClick={onOpenApplications}>View all <ArrowRight size={16} /></button></div><ApplicationTable compact entries={entries.slice(0, 5)} onEdit={onEdit} emptyMessage="No applications yet." /></section>
    </div>
  )
}

function Metric({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{suffix && <small>{suffix}</small>}</div>
}

function formatWeekRange(start: Date, end: Date): string {
  const left = start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const right = end.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  return `${left} – ${right}`
}
