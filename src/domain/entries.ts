import { isApplicationStatus, isValidDateOnly } from './status'
import type { ApplicationEntry, ApplicationInput, ApplicationOrigin, StatusEvent } from './types'

export function createApplication(input: ApplicationInput): ApplicationEntry {
  const company = required(input.company, 'Company is required.')
  const title = required(input.title, 'Role title is required.')
  if (!isValidDateOnly(input.submittedDate)) throw new Error('Submission date is not valid.')
  if (input.effort !== 'quick' && input.effort !== 'targeted') {
    throw new Error('Application effort is not valid.')
  }

  const statusHistory = normalizeHistory(input.statusHistory, input.submittedDate)
  const nextAction = clean(input.nextAction)
  const nextActionDueDate = clean(input.nextActionDueDate)
  if (nextActionDueDate && !isValidDateOnly(nextActionDueDate)) throw new Error('Next-action due date is not valid.')
  if (nextActionDueDate && !nextAction) throw new Error('Choose a next action before adding a due date.')

  return compact({
    id: input.id ?? crypto.randomUUID(),
    company,
    title,
    submittedDate: input.submittedDate,
    effort: input.effort,
    source: clean(input.source),
    url: clean(input.url),
    resumeVariant: clean(input.resumeVariant),
    notes: clean(input.notes),
    nextAction,
    nextActionDueDate,
    nextActionCompleted: nextAction ? input.nextActionCompleted === true : undefined,
    nextActionCompletedAt: nextAction && input.nextActionCompleted === true
      ? normalizeIso(input.nextActionCompletedAt)
      : undefined,
    jobDescriptionExcerpt: clean(input.jobDescriptionExcerpt),
    origin: normalizeOrigin(input.origin),
    statusHistory,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }) as ApplicationEntry
}

function normalizeOrigin(origin?: ApplicationOrigin): ApplicationOrigin | undefined {
  if (!origin) return undefined
  const messageId = origin.messageId?.trim()
  if (origin.provider !== 'gmail' || !messageId) throw new Error('Application origin is not valid.')
  return { provider: 'gmail', messageId }
}

function normalizeHistory(history: StatusEvent[] | undefined, submittedDate: string): StatusEvent[] {
  if (!history) {
    return [{ id: crypto.randomUUID(), status: 'applied', date: submittedDate }]
  }
  if (history.length === 0) throw new Error('Status history is required.')

  const normalized = history.map((event) => {
    if (!event || typeof event.id !== 'string' || !event.id || !isApplicationStatus(event.status)) {
      throw new Error('Status history is not valid.')
    }
    if (!isValidDateOnly(event.date) || event.date < submittedDate) {
      throw new Error('Status history is not valid.')
    }
    return compact({
      id: event.id,
      status: event.status,
      date: event.date,
      origin: normalizeOrigin(event.origin),
    }) as StatusEvent
  })

  normalized.sort((a, b) => a.date.localeCompare(b.date))
  if (normalized[0].status !== 'applied' || normalized[0].date !== submittedDate) {
    throw new Error('Status history must begin with the submitted application.')
  }
  return normalized
}

function required(value: string, message: string): string {
  const result = value?.trim()
  if (!result) throw new Error(message)
  return result
}

function clean(value?: string): string | undefined {
  const result = value?.trim()
  return result || undefined
}

function normalizeIso(value?: string): string {
  if (!value) return new Date().toISOString()
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new Error('Next-action completion time is not valid.')
  return new Date(time).toISOString()
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
