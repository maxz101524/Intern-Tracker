import { ArrowUpRight, CalendarDays } from 'lucide-react'
import { buildDailySeries, buildWeeklySeries, getWeekSummary, startOfMonday } from '../domain/analytics'
import type { ApplicationEntry, AppSettings, EntryInput } from '../domain/types'
import { EntryRow } from './EntryRow'
import { QuickLog } from './QuickLog'

interface DashboardProps {
  entries: ApplicationEntry[]
  settings: AppSettings
  onLog: (entry: EntryInput) => Promise<void>
  onEdit: (entry: ApplicationEntry) => void
  onOpenHistory: () => void
}

export function Dashboard({ entries, settings, onLog, onEdit, onOpenHistory }: DashboardProps) {
  const now = new Date()
  const summary = getWeekSummary(entries, settings.weeklyTarget, now)
  const daily = buildDailySeries(entries, now)
  const weekly = buildWeeklySeries(entries, now)
  const maxDaily = Math.max(1, ...daily.map((day) => day.total))
  const maxWeekly = Math.max(1, ...weekly.map((week) => week.total), settings.weeklyTarget)
  const weekStart = startOfMonday(now)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const progress = settings.weeklyTarget
    ? Math.min(100, (summary.submitted / settings.weeklyTarget) * 100)
    : 0

  return (
    <div className="page-content dashboard-page">
      <header className="page-header">
        <div>
          <p className="context-label">{formatWeekRange(weekStart, weekEnd)}</p>
          <h1>Your application week</h1>
        </div>
        <div className={`pace-status ${summary.isOnTrack ? 'on-track' : 'behind'}`}>
          <span aria-hidden="true" />
          {summary.isOnTrack ? 'On pace' : 'Needs a push'}
        </div>
      </header>

      <section className="week-board" aria-labelledby="week-progress-heading">
        <div className="week-numbers">
          <div>
            <span id="week-progress-heading">Applications this week</span>
            <strong aria-label={`${summary.submitted} of ${settings.weeklyTarget} applications`}>{summary.submitted} <em>of {settings.weeklyTarget}</em></strong>
          </div>
          <div className="remaining-block">
            <span>Remaining</span>
            <strong>{summary.remaining}</strong>
          </div>
          <div className="pace-block">
            <span>Needed per day</span>
            <strong>{summary.requiredDailyPace.toFixed(1)}</strong>
          </div>
        </div>
        <div className="progress-track" aria-label={`${Math.round(progress)} percent of weekly target`}>
          <span style={{ width: `${progress}%` }} />
          <i style={{ left: `${Math.min(100, (summary.expectedByNow / settings.weeklyTarget) * 100)}%` }} title="Expected by today" />
        </div>
        <div className="daily-chart" role="img" aria-label="Applications submitted each day this week">
          {daily.map((day) => (
            <div className="day-column" key={day.date.toISOString()}>
              <span className="day-count">{day.total || ''}</span>
              <div className="day-bar-track">
                <span className="day-bar targeted" style={{ height: `${(day.targeted / maxDaily) * 100}%` }} />
                <span className="day-bar quick" style={{ height: `${(day.quick / maxDaily) * 100}%` }} />
              </div>
              <b>{day.label.slice(0, 2)}</b>
            </div>
          ))}
        </div>
        <div className="mix-row">
          <span><i className="legend-dot quick" /> Quick <strong>{summary.quick}</strong></span>
          <span><i className="legend-dot targeted" /> Targeted <strong>{summary.targeted}</strong></span>
          <span className="expected"><CalendarDays size={15} /> Expected by today: {summary.expectedByNow}</span>
        </div>
      </section>

      <div className="dashboard-grid">
        <QuickLog sources={settings.sources} onLog={onLog} />
        <section className="recent-panel" aria-labelledby="recent-heading">
          <div className="section-heading-row">
            <div><h2 id="recent-heading">Recent activity</h2><p>Your latest logged applications.</p></div>
            <button type="button" className="text-button" onClick={onOpenHistory}>View all <ArrowUpRight size={16} /></button>
          </div>
          <div className="entry-list">
            {entries.slice(0, 5).map((entry) => <EntryRow key={entry.id} entry={entry} compact onEdit={onEdit} />)}
            {entries.length === 0 && <div className="empty-state"><strong>No applications yet</strong><span>Your first log will appear here.</span></div>}
          </div>
        </section>
      </div>

      <section className="trend-strip" aria-labelledby="trend-heading">
        <div><h2 id="trend-heading">Eight-week rhythm</h2><p>Volume over time, without turning the search into a scoreboard.</p></div>
        <div className="weekly-chart" role="img" aria-label="Application totals for the last eight weeks">
          {weekly.map((week) => (
            <div key={week.weekStart.toISOString()}>
              <span>{week.total || ''}</span>
              <i style={{ height: `${Math.max(3, (week.total / maxWeekly) * 100)}%` }} />
              <b>{week.label}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function formatWeekRange(start: Date, end: Date) {
  const startText = start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const endText = end.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  return `${startText} – ${endText}`
}
