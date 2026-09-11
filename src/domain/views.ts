import { getDisplayStatus, startOfMondayDate, todayDate } from './status'
import type { ApplicationEntry, ApplicationFilterState, ApplicationViewMetric, DisplayStatus } from './types'

export const EMPTY_FILTERS: ApplicationFilterState = {
  query: '',
  status: 'all',
  effort: 'all',
  source: 'all',
  fromDate: '',
  toDate: '',
}

const IN_PROGRESS: DisplayStatus[] = ['online_assessment', 'recruiter_screen', 'interview']
const AWAITING_RESPONSE: DisplayStatus[] = ['applied', 'no_response']

export function filterApplications(
  entries: ApplicationEntry[],
  filters: ApplicationFilterState,
  today = todayDate(),
): ApplicationEntry[] {
  const needle = filters.query.trim().toLowerCase()
  const weekStart = startOfMondayDate(today)
  return entries.filter((entry) => {
    const displayStatus = getDisplayStatus(entry, today)
    const searchable = [entry.company, entry.title, entry.source, entry.resumeVariant, entry.notes, entry.nextAction]
      .filter(Boolean).join(' ').toLowerCase()
    return (!needle || searchable.includes(needle)) &&
      (filters.status === 'all' || displayStatus === filters.status) &&
      (filters.effort === 'all' || entry.effort === filters.effort) &&
      (filters.source === 'all' || entry.source === filters.source) &&
      (!filters.fromDate || entry.submittedDate >= filters.fromDate) &&
      (!filters.toDate || entry.submittedDate <= filters.toDate) &&
      (!filters.preset || matchesPreset(entry, displayStatus, filters.preset, today, weekStart)) &&
      (!filters.metric || matchesMetric(entry, displayStatus, filters.metric))
  })
}

export function matchesMetric(
  entry: ApplicationEntry,
  displayStatus: DisplayStatus,
  metric: ApplicationViewMetric,
): boolean {
  if (metric === 'any_response') {
    return entry.statusHistory.some(({ status }) => status !== 'applied' && status !== 'withdrawn')
  }
  if (metric === 'progressed') {
    return entry.statusHistory.some(({ status }) =>
      ['online_assessment', 'recruiter_screen', 'interview', 'offer'].includes(status),
    )
  }
  if (metric === 'rejected') return displayStatus === 'rejected'
  if (metric === 'awaiting_response') return AWAITING_RESPONSE.includes(displayStatus)
  return IN_PROGRESS.includes(displayStatus)
}

function matchesPreset(
  entry: ApplicationEntry,
  displayStatus: DisplayStatus,
  preset: NonNullable<ApplicationFilterState['preset']>,
  today: string,
  weekStart: string,
): boolean {
  if (preset === 'in_progress') return IN_PROGRESS.includes(displayStatus)
  if (preset === 'awaiting_response') return AWAITING_RESPONSE.includes(displayStatus)
  return entry.submittedDate >= weekStart && entry.submittedDate <= today
}

export function activeFilterLabels(filters: ApplicationFilterState): string[] {
  const labels: string[] = []
  if (filters.preset) labels.push({ in_progress: 'In progress', this_week: 'This week', awaiting_response: 'Awaiting response' }[filters.preset])
  if (filters.metric) labels.push({
    any_response: 'Any response', progressed: 'Progressed', rejected: 'Rejected',
    awaiting_response: 'Awaiting response', in_progress: 'In progress',
  }[filters.metric])
  if (filters.status !== 'all') labels.push(filters.status.replaceAll('_', ' '))
  if (filters.effort !== 'all') labels.push(filters.effort)
  if (filters.source !== 'all') labels.push(filters.source)
  if (filters.fromDate || filters.toDate) labels.push(`${filters.fromDate || 'Any date'} to ${filters.toDate || 'today'}`)
  if (filters.query) labels.push(`Search: ${filters.query}`)
  return labels
}
