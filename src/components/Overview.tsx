import { ArrowRight, CalendarClock, CalendarDays, Check, Clock3, Plus } from 'lucide-react'
import { getAttentionGroups } from '../domain/attention'
import { buildDailySeries, formatShortDate, getOutcomeMetrics, getPipelineSummary, getWeekSummary, startOfMonday } from '../domain/analytics'
import { completeNextAction, snoozeNextAction, statusLabel, todayDate } from '../domain/status'
import type { ApplicationEntry, ApplicationFilterState, AppSettings, DisplayStatus } from '../domain/types'
import { ApplicationTable } from './ApplicationTable'

interface OverviewProps {
  entries: ApplicationEntry[]
  settings: AppSettings
  onAdd: () => void
  onEdit: (entry: ApplicationEntry) => void
  onUpdateEntry: (next: ApplicationEntry, previous: ApplicationEntry, message: string) => Promise<void>
  onOpenApplications: (filters?: Partial<ApplicationFilterState>) => void
}

const pipelineOrder: DisplayStatus[] = ['applied', 'no_response', 'online_assessment', 'recruiter_screen', 'interview', 'offer', 'rejected']

export function Overview({ entries, settings, onAdd, onEdit, onUpdateEntry, onOpenApplications }: OverviewProps) {
  const now = new Date()
  const today = todayDate(now)
  const summary = getWeekSummary(entries, settings.weeklyTarget, now, settings.applicationDays)
  const metrics = getOutcomeMetrics(entries, today)
  const pipeline = getPipelineSummary(entries, today)
  const attention = getAttentionGroups(entries, today)
  const daily = buildDailySeries(entries, now)
  const maxDaily = Math.max(1, ...daily.map(({ total }) => total))
  const weekStart = startOfMonday(now)
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6)
  const progress = settings.weeklyTarget ? Math.min(100, summary.submitted / settings.weeklyTarget * 100) : 0
  const attentionTotal = attention.overdue.length + attention.today.length + attention.upcoming.length

  async function done(entry: ApplicationEntry) {
    await onUpdateEntry(completeNextAction(entry), entry, 'Next action completed')
  }

  async function snooze(entry: ApplicationEntry) {
    await onUpdateEntry(snoozeNextAction(entry, 3, today), entry, 'Next action snoozed three days')
  }

  return (
    <div className="page-content overview-page">
      <header className="page-header action-header">
        <div><p className="context-label">{formatWeekRange(weekStart, weekEnd)}</p><h1>Your search, at a glance</h1><p>Keep the volume moving without losing track of individual roles.</p></div>
        <button type="button" className="button primary" aria-label="Add application" onClick={onAdd}><Plus size={17} /> Add application <kbd aria-hidden="true">N</kbd></button>
      </header>

      <section className="pace-strip" aria-label={`${summary.submitted} of ${settings.weeklyTarget} applications`}>
        <div className="pace-primary"><span>Applications this week</span><strong>{summary.submitted}<em> / {settings.weeklyTarget}</em></strong><div className="progress-track"><i style={{ width: `${progress}%` }} /><b style={{ left: `${Math.min(100, summary.expectedByNow / Math.max(1, settings.weeklyTarget) * 100)}%` }} /></div></div>
        <Metric label="Remaining" value={summary.remaining} />
        <Metric label="Needed per application day" value={summary.requiredDailyPace.toFixed(1)} />
        <div className={`pace-readout ${summary.remaining === 0 || summary.isOnTrack ? 'on-track' : 'behind'}`}><span />{summary.remaining === 0 ? 'Weekly target reached' : summary.isOnTrack ? 'On pace' : 'Needs a push'}<small>Expected by today: {summary.expectedByNow}</small></div>
      </section>

      <section className="health-strip interactive-metrics" aria-label="Search outcomes">
        <MetricButton label="Awaiting response" value={metrics.awaitingResponse} onClick={() => onOpenApplications({ metric: 'awaiting_response' })} />
        <MetricButton label="In progress" value={metrics.inProgress} onClick={() => onOpenApplications({ metric: 'in_progress' })} />
        <MetricButton label="Any response" value={metrics.anyResponse} suffix={`${metrics.anyResponseRate}%`} onClick={() => onOpenApplications({ metric: 'any_response' })} />
        <MetricButton label="Progressed" value={metrics.progressed} suffix={`${metrics.progressedRate}%`} onClick={() => onOpenApplications({ metric: 'progressed' })} />
        <MetricButton label="Rejected" value={metrics.rejected} suffix={`${metrics.rejectedRate}%`} onClick={() => onOpenApplications({ metric: 'rejected' })} />
      </section>

      {attentionTotal > 0 && <section className="attention-panel" aria-labelledby="attention-title">
        <div className="section-heading"><div><h2 id="attention-title">Needs attention</h2><p>Deadlines and follow-ups, ordered by urgency.</p></div><span className="attention-count"><CalendarClock size={16} />{attentionTotal}</span></div>
        <div className="attention-groups">
          <AttentionGroup label="Overdue" tone="overdue" entries={attention.overdue} onDone={done} onSnooze={snooze} onOpen={onEdit} />
          <AttentionGroup label="Today" tone="today" entries={attention.today} onDone={done} onSnooze={snooze} onOpen={onEdit} />
          <AttentionGroup label="Upcoming" tone="upcoming" entries={attention.upcoming} onDone={done} onSnooze={snooze} onOpen={onEdit} />
        </div>
      </section>}

      <div className="overview-grid">
        <section className="panel daily-panel"><div className="section-heading"><div><h2>Application rhythm</h2><p>Quick and Targeted submissions this week.</p></div><span className="expected-label"><CalendarDays size={15} /> Mon–Sun</span></div><div className="daily-chart" role="img" aria-label="Daily Quick and Targeted applications">{daily.map((day) => <div className="day-column" key={day.label}><span>{day.total || ''}</span><div className="day-bars"><i className="targeted" style={{ height: `${day.targeted / maxDaily * 100}%` }} /><i className="quick" style={{ height: `${day.quick / maxDaily * 100}%` }} /></div><b>{day.label.slice(0, 2)}</b></div>)}</div><div className="chart-legend"><span><i className="quick" /> Quick <strong>{summary.quick}</strong></span><span><i className="targeted" /> Targeted <strong>{summary.targeted}</strong></span></div></section>

        <section className="panel pipeline-panel"><div className="section-heading"><div><h2>Current pipeline</h2><p>Select a count to open the exact ledger view.</p></div></div><div className="pipeline-list">{pipelineOrder.filter((status) => pipeline[status] > 0 || ['applied', 'no_response', 'interview'].includes(status)).map((status) => <button type="button" key={status} onClick={() => onOpenApplications({ status })}><span className={`pipeline-dot status-${status}`} /><span>{statusLabel(status)}</span><strong>{pipeline[status]}</strong><i style={{ width: `${metrics.total ? pipeline[status] / metrics.total * 100 : 0}%` }} /></button>)}</div></section>
      </div>

      <section className="panel recent-section"><div className="section-heading"><div><h2>Recent applications</h2><p>The latest roles added to your ledger.</p></div><button type="button" className="text-button" onClick={() => onOpenApplications()}>View all <ArrowRight size={16} /></button></div><ApplicationTable compact entries={entries.slice(0, 5)} onEdit={onEdit} emptyMessage="No applications yet." /></section>
    </div>
  )
}

function AttentionGroup({ label, tone, entries, onDone, onSnooze, onOpen }: {
  label: string
  tone: string
  entries: ApplicationEntry[]
  onDone: (entry: ApplicationEntry) => Promise<void>
  onSnooze: (entry: ApplicationEntry) => Promise<void>
  onOpen: (entry: ApplicationEntry) => void
}) {
  if (!entries.length) return null
  return <div className={`attention-group ${tone}`}><h3>{label}<span>{entries.length}</span></h3>{entries.map((entry) => <article key={entry.id}><div><strong>{entry.nextAction}</strong><span>{entry.company} · {entry.title}</span><time dateTime={entry.nextActionDueDate}>{formatShortDate(entry.nextActionDueDate!)}</time></div><div><button type="button" className="button action-done" onClick={() => void onDone(entry)}><Check size={15} /> Done</button><button type="button" className="button secondary" onClick={() => void onSnooze(entry)}><Clock3 size={15} /> Snooze</button><button type="button" className="text-button" onClick={() => onOpen(entry)}>Open application</button></div></article>)}</div>
}

function Metric({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{suffix && <small>{suffix}</small>}</div>
}

function MetricButton({ label, value, suffix, onClick }: { label: string; value: number; suffix?: string; onClick: () => void }) {
  return <button type="button" className="metric" onClick={onClick}><span>{label}</span><strong>{value}</strong>{suffix && <small>{suffix}</small>}</button>
}

function formatWeekRange(start: Date, end: Date): string {
  const left = start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const right = end.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  return `${left} – ${right}`
}
