import type { ApplicationEntry, ApplicationOrigin, ApplicationStatus, DisplayStatus, StatusEvent } from './types'

export const NO_RESPONSE_DAYS = 21

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  'applied',
  'online_assessment',
  'recruiter_screen',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
]

export function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return typeof value === 'string' && APPLICATION_STATUSES.includes(value as ApplicationStatus)
}

export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

export function todayDate(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function startOfMondayDate(value = todayDate()): string {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return todayDate(date)
}

export function getCurrentStatus(entry: ApplicationEntry): ApplicationStatus {
  return entry.statusHistory.at(-1)?.status ?? 'applied'
}

export function getDisplayStatus(entry: ApplicationEntry, today = todayDate()): DisplayStatus {
  const current = getCurrentStatus(entry)
  if (current !== 'applied') return current
  const elapsed = calendarDayNumber(today) - calendarDayNumber(entry.submittedDate)
  return elapsed >= NO_RESPONSE_DAYS ? 'no_response' : 'applied'
}

export function appendStatus(
  entry: ApplicationEntry,
  status: ApplicationStatus,
  date: string,
  origin?: ApplicationOrigin,
): ApplicationEntry {
  if (!isApplicationStatus(status)) throw new Error('Application status is not valid.')
  if (!isValidDateOnly(date)) throw new Error('Status date is not valid.')
  if (date < entry.submittedDate) {
    throw new Error('Status date cannot be before the submission date.')
  }
  if (origin && entry.statusHistory.some((event) => event.origin?.provider === origin.provider && event.origin.messageId === origin.messageId)) {
    return entry
  }
  if (getCurrentStatus(entry) === status) return entry

  const nextEvent: StatusEvent = origin
    ? { id: crypto.randomUUID(), status, date, origin }
    : { id: crypto.randomUUID(), status, date }
  const statusHistory = [...entry.statusHistory, nextEvent]
    .map((event, index) => ({ event, index }))
    .sort((a, b) => a.event.date.localeCompare(b.event.date) || a.index - b.index)
    .map(({ event }) => event)

  return { ...entry, statusHistory, updatedAt: new Date().toISOString() }
}

export function replaceStatusHistory(entry: ApplicationEntry, statusHistory: StatusEvent[]): ApplicationEntry {
  if (statusHistory.length === 0) throw new Error('Status history is required.')
  const normalized = statusHistory.map((event) => ({ ...event }))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (normalized[0].status !== 'applied' || normalized[0].date !== entry.submittedDate) {
    throw new Error('Status history must begin with the submitted application.')
  }
  for (const event of normalized) {
    if (!event.id || !isApplicationStatus(event.status) || !isValidDateOnly(event.date) || event.date < entry.submittedDate) {
      throw new Error('Status history is not valid.')
    }
  }
  return { ...entry, statusHistory: normalized, updatedAt: new Date().toISOString() }
}

export function completeNextAction(entry: ApplicationEntry, completedAt = new Date().toISOString()): ApplicationEntry {
  if (!entry.nextAction) return entry
  return { ...entry, nextActionCompleted: true, nextActionCompletedAt: completedAt, updatedAt: completedAt }
}

export function snoozeNextAction(entry: ApplicationEntry, days = 3, today = todayDate()): ApplicationEntry {
  if (!entry.nextAction) return entry
  const start = entry.nextActionDueDate && entry.nextActionDueDate > today ? entry.nextActionDueDate : today
  const date = parseLocalDate(start)
  date.setDate(date.getDate() + days)
  return {
    ...entry,
    nextActionDueDate: todayDate(date),
    nextActionCompleted: false,
    nextActionCompletedAt: undefined,
    updatedAt: new Date().toISOString(),
  }
}

export function daysSinceUpdate(entry: ApplicationEntry, today = todayDate()): number {
  const updated = todayDate(new Date(entry.updatedAt))
  return Math.max(0, calendarDayNumber(today) - calendarDayNumber(updated))
}

export function statusLabel(status: DisplayStatus): string {
  const labels: Record<DisplayStatus, string> = {
    applied: 'Applied',
    no_response: 'No response',
    online_assessment: 'Online assessment',
    recruiter_screen: 'Recruiter screen',
    interview: 'Interview',
    offer: 'Offer',
    rejected: 'Rejected',
    withdrawn: 'Withdrawn',
  }
  return labels[status]
}

function calendarDayNumber(value: string): number {
  if (!isValidDateOnly(value)) throw new Error('Calendar date is not valid.')
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}
