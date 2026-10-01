import { useRef, useState } from 'react'
import { ArrowRight, CalendarClock, CalendarDays, Check, CheckCheck, Clock3, Plus } from 'lucide-react'
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

type FocusFilter = 'all' | 'due-soon' | 'no-date'
type ActionTone = 'overdue' | 'today' | 'upcoming' | 'no-date'
interface FocusAction { entry: ApplicationEntry; tone: ActionTone; label: string }

const pipelineOrder: DisplayStatus[] = ['applied', 'no_response', 'online_assessment', 'recruiter_screen', 'interview', 'offer', 'rejected', 'withdrawn']
const gaugeCircumference = 2 * Math.PI * 82
const focusLimit = 4

export function Overview({ entries, settings, onAdd, onEdit, onUpdateEntry, onOpenApplications }: OverviewProps) {
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('all')
  const [showAllActions, setShowAllActions] = useState(false)
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
  const dueSoonEnd = todayDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7))
  const actions: FocusAction[] = [
    ...attention.overdue.map((entry) => ({ entry, tone: 'overdue' as const, label: 'Overdue' })),
    ...attention.today.map((entry) => ({ entry, tone: 'today' as const, label: 'Today' })),
    ...attention.upcoming.map((entry) => ({ entry, tone: 'upcoming' as const, label: 'Upcoming' })),
    ...attention.noDate.map((entry) => ({ entry, tone: 'no-date' as const, label: 'No date' })),
  ]
  const filteredActions = actions.filter(({ entry, tone }) => focusFilter === 'all' ||
    (focusFilter === 'no-date' ? tone === 'no-date' : Boolean(entry.nextActionDueDate && entry.nextActionDueDate <= dueSoonEnd)))
  const visibleActions = showAllActions ? filteredActions : filteredActions.slice(0, focusLimit)
  const targetReached = summary.remaining === 0
  const paceLabel = targetReached ? 'Weekly target reached' : summary.isOnTrack ? 'On pace' : 'Needs a push'
  const paceGuidance = targetReached
    ? 'A strong week. Make room for preparation and follow-ups.'
    : summary.isOnTrack
      ? 'Your rhythm is working. Keep your next application moving.'
      : `${Math.max(0, summary.expectedByNow - summary.submitted)} more to meet today’s pace. Start with one role that fits.`

  async function done(entry: ApplicationEntry) {
    await onUpdateEntry(completeNextAction(entry), entry, 'Next action completed')
  }

  async function snooze(entry: ApplicationEntry) {
    await onUpdateEntry(snoozeNextAction(entry, 3, today), entry, 'Next action snoozed three days')
  }

  function selectFocusFilter(filter: FocusFilter) {
    setFocusFilter(filter)
    setShowAllActions(false)
  }

  return (
    <div className="page-content overview-page">
      <header className="page-header action-header">
        <div><p className="context-label">Your next move starts here</p><h1>Your search, at a glance</h1><p>Keep a steady pace. Give every promising role a clear next step.</p></div>
        <button type="button" className="button primary" aria-label="Add application" onClick={onAdd}><Plus size={17} /> Add application <kbd aria-hidden="true">N</kbd></button>
      </header>

      <div className="overview-focus-grid">
        <section className="panel pace-card" aria-label={`${summary.submitted} of ${settings.weeklyTarget} applications`}>
          <div className="pace-card-heading"><p className="context-label">{formatWeekRange(weekStart, weekEnd)}</p><span className={`pace-state ${targetReached || summary.isOnTrack ? 'on-track' : 'behind'}`}><span />{paceLabel}</span></div>
          <div className="pace-card-body">
            <div className="pace-gauge">
              <svg viewBox="0 0 200 200" aria-hidden="true"><circle className="pace-gauge-track" cx="100" cy="100" r="82" fill="none" strokeWidth="10" /><circle className="pace-gauge-progress" cx="100" cy="100" r="82" fill="none" stroke="#6c55ca" strokeWidth="10" strokeLinecap="round" strokeDasharray={gaugeCircumference} strokeDashoffset={gaugeCircumference * (1 - progress / 100)} transform="rotate(-90 100 100)" /></svg>
              <div className="pace-gauge-value"><strong>{summary.submitted}<em> / {settings.weeklyTarget}</em></strong><span>Applications this week</span></div>
            </div>
            <div className="pace-summary">
              <div className="pace-stats"><Metric label="Remaining" value={summary.remaining} /><Metric label="Needed per application day" value={summary.requiredDailyPace.toFixed(1)} /></div>
              <p className="pace-guidance">{paceGuidance}</p>
              <span className="pace-expected">Expected by today: {summary.expectedByNow}</span>
            </div>
          </div>
          <div className="pace-card-footer"><span>{Math.round(progress)}% of weekly goal</span><button type="button" className="text-button" onClick={() => onOpenApplications({ fromDate: todayDate(weekStart), toDate: todayDate(weekEnd) })}>This week’s applications <ArrowRight size={15} /></button></div>
        </section>

        <section className="panel focus-panel" aria-labelledby="attention-title">
          <div className="section-heading"><div><h2 id="attention-title">Needs attention</h2><p>Your next actions, ordered by urgency.</p></div><span className="attention-count" aria-label={`${actions.length} next actions`}><CalendarClock size={16} />{actions.length}</span></div>
          <div className="focus-tabs" role="group" aria-label="Filter next actions">
            <button type="button" aria-pressed={focusFilter === 'all'} onClick={() => selectFocusFilter('all')}>All</button>
            <button type="button" aria-pressed={focusFilter === 'due-soon'} onClick={() => selectFocusFilter('due-soon')}>Due soon</button>
            <button type="button" aria-pressed={focusFilter === 'no-date'} onClick={() => selectFocusFilter('no-date')}>No date <span>{attention.noDate.length}</span></button>
          </div>
          {filteredActions.length > 0 ? <>
            <div className="focus-actions" id="overview-focus-actions">{visibleActions.map((action) => <NextActionRow key={action.entry.id} action={action} onDone={done} onSnooze={snooze} onOpen={onEdit} />)}</div>
            <div className="focus-footer"><span>{visibleActions.length} of {filteredActions.length} {filteredActions.length === 1 ? 'action' : 'actions'}{focusFilter === 'due-soon' && ' · next 7 days'}</span>{filteredActions.length > focusLimit && <button type="button" className="text-button" aria-expanded={showAllActions} aria-controls="overview-focus-actions" onClick={() => setShowAllActions(!showAllActions)}>{showAllActions ? 'Show fewer' : 'Show all actions'} <ArrowRight size={14} /></button>}</div>
          </> : <div className="focus-empty"><span className="focus-empty-icon"><CheckCheck size={24} /></span><h3>{focusFilter === 'no-date' ? 'No unscheduled actions' : focusFilter === 'due-soon' ? 'Nothing due in the next 7 days' : 'You’re clear for now'}</h3><p>{focusFilter === 'all' ? 'Add a next action to a role so your follow-ups and preparation stay in view.' : focusFilter === 'no-date' ? 'You can add an action without a date and plan it here when you’re ready.' : 'Use All to review later deadlines, or plan a follow-up for a promising role.'}</p><button type="button" className="text-button" onClick={entries.length ? () => onOpenApplications({}) : onAdd}>{entries.length ? 'Choose an application' : 'Add your first application'} <ArrowRight size={15} /></button></div>}
        </section>
      </div>

      <section className="health-strip interactive-metrics" aria-label="Search outcomes">
        <MetricButton label="Awaiting response" value={metrics.awaitingResponse} onClick={() => onOpenApplications({ metric: 'awaiting_response' })} />
        <MetricButton label="In progress" value={metrics.inProgress} onClick={() => onOpenApplications({ metric: 'in_progress' })} />
        <MetricButton label="Any response" value={metrics.anyResponse} suffix={`${metrics.anyResponseRate}%`} onClick={() => onOpenApplications({ metric: 'any_response' })} />
        <MetricButton label="Progressed" value={metrics.progressed} suffix={`${metrics.progressedRate}%`} onClick={() => onOpenApplications({ metric: 'progressed' })} />
        <MetricButton label="Rejected" value={metrics.rejected} suffix={`${metrics.rejectedRate}%`} onClick={() => onOpenApplications({ metric: 'rejected' })} />
      </section>

      <div className="overview-grid">
        <section className="panel daily-panel"><div className="section-heading"><div><h2>Application rhythm</h2><p>Select a day to see the roles you submitted.</p></div><span className="expected-label"><CalendarDays size={15} /> Mon–Sun</span></div><div className="daily-chart" role="group" aria-label="Daily Quick and Targeted applications">{daily.map((day) => {
          const dayKey = todayDate(day.date)
          const isToday = dayKey === today
          return <button type="button" className={`day-column ${isToday ? 'is-today' : ''}`} key={dayKey} aria-label={`${day.label}, ${formatShortDate(dayKey)}: ${day.total} applications${isToday ? ', today' : ''}`} onClick={() => onOpenApplications({ fromDate: dayKey, toDate: dayKey })}><span>{day.total || '0'}</span><div className="day-bars"><i className="targeted" style={{ height: `${day.targeted / maxDaily * 100}%` }} /><i className="quick" style={{ height: `${day.quick / maxDaily * 100}%` }} /></div><b>{day.label.slice(0, 2)}</b><i className="day-current-marker" aria-hidden="true" /></button>
        })}</div><div className="chart-legend"><span><i className="quick" /> Quick <strong>{summary.quick}</strong></span><span><i className="targeted" /> Targeted <strong>{summary.targeted}</strong></span><span className="chart-today-label">Today marked below</span></div></section>

        <section className="panel pipeline-panel"><div className="section-heading"><div><h2>Current pipeline</h2><p>Open a stage to keep the next step moving.</p></div></div><div className="pipeline-list">{pipelineOrder.filter((status) => pipeline[status] > 0 || ['applied', 'no_response', 'interview'].includes(status)).map((status) => <button type="button" key={status} onClick={() => onOpenApplications({ status })}><span className={`pipeline-dot status-${status}`} /><span>{statusLabel(status)}</span><strong>{pipeline[status]}</strong><i style={{ width: `${metrics.total ? pipeline[status] / metrics.total * 100 : 0}%` }} /></button>)}</div></section>
      </div>

      <section className="panel recent-section"><div className="section-heading"><div><h2>Recent applications</h2><p>The latest roles added to your ledger.</p></div><button type="button" className="text-button" onClick={() => onOpenApplications({})}>View all <ArrowRight size={16} /></button></div><ApplicationTable compact entries={entries.slice(0, 5)} onEdit={onEdit} emptyMessage="No applications yet. Add your first role to start your week." /></section>
    </div>
  )
}

function NextActionRow({ action: { entry, tone, label }, onDone, onSnooze, onOpen }: {
  action: FocusAction
  onDone: (entry: ApplicationEntry) => Promise<void>
  onSnooze: (entry: ApplicationEntry) => Promise<void>
  onOpen: (entry: ApplicationEntry) => void
}) {
  const pendingRef = useRef(false)
  const [pending, setPending] = useState<'done' | 'snooze' | null>(null)
  const [error, setError] = useState('')

  async function updateAction(kind: 'done' | 'snooze') {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(kind)
    setError('')
    try {
      await (kind === 'done' ? onDone(entry) : onSnooze(entry))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Couldn’t save this action. Please try again.')
    } finally {
      pendingRef.current = false
      setPending(null)
    }
  }

  return <article className={`focus-action ${tone}`} aria-label={`${entry.nextAction} for ${entry.company}`}>
    <div className="focus-action-main"><strong>{entry.nextAction}</strong><span>{entry.company} · {entry.title}</span><div className="focus-action-meta"><span className="action-urgency">{label}</span>{entry.nextActionDueDate && <time dateTime={entry.nextActionDueDate}>{formatShortDate(entry.nextActionDueDate)}</time>}</div></div>
    <div className="focus-action-controls"><button type="button" className="button action-done" disabled={pending !== null} onClick={() => void updateAction('done')}><Check size={14} /> {pending === 'done' ? 'Saving…' : 'Done'}</button><button type="button" className="button secondary" disabled={pending !== null} onClick={() => void updateAction('snooze')} title="Move this action three days later"><Clock3 size={14} /> {pending === 'snooze' ? 'Saving…' : 'Snooze'}</button><button type="button" className="text-button" disabled={pending !== null} onClick={() => onOpen(entry)}>Open <ArrowRight size={14} /></button></div>
    {error && <p className="field-error focus-action-error" role="alert">{error}</p>}
  </article>
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>
}

function MetricButton({ label, value, suffix, onClick }: { label: string; value: number; suffix?: string; onClick: () => void }) {
  return <button type="button" className="metric" onClick={onClick}><span>{label}</span><strong>{value}</strong>{suffix && <small>{suffix}</small>}</button>
}

function formatWeekRange(start: Date, end: Date): string {
  const left = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const right = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${left} – ${right}`
}
