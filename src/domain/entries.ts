import { isApplicationStatus, isValidDateOnly } from './status'
import type { ApplicationEntry, ApplicationInput, StatusEvent } from './types'

export function createApplication(input: ApplicationInput): ApplicationEntry {
  const company = required(input.company, 'Company is required.')
  const title = required(input.title, 'Role title is required.')
  if (!isValidDateOnly(input.submittedDate)) throw new Error('Submission date is not valid.')
  if (input.effort !== 'quick' && input.effort !== 'targeted') {
    throw new Error('Application effort is not valid.')
  }

  const statusHistory = normalizeHistory(input.statusHistory, input.submittedDate)

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
    statusHistory,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }) as ApplicationEntry
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
    return { id: event.id, status: event.status, date: event.date }
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

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
