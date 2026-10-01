import { getCurrentStatus } from './status'
import type { ApplicationEntry, ApplicationStatus, StatusEvent } from './types'

export interface AttentionGroups {
  overdue: ApplicationEntry[]
  today: ApplicationEntry[]
  upcoming: ApplicationEntry[]
  noDate: ApplicationEntry[]
}

export interface StageAction {
  entry: ApplicationEntry
  status: ApplicationStatus
  action: string
  since: string
}

export interface RecentResponse {
  entry: ApplicationEntry
  event: StatusEvent
}

// Employer stages that ask something of you. Offers come first because they usually carry a deadline.
export const STAGE_ACTIONS: Partial<Record<ApplicationStatus, string>> = {
  offer: 'Decide on the offer',
  interview: 'Prepare for the interview',
  recruiter_screen: 'Prepare for the recruiter screen',
  online_assessment: 'Complete the online assessment',
}
const STAGE_PRIORITY: ApplicationStatus[] = ['offer', 'interview', 'recruiter_screen', 'online_assessment']

export function getAttentionGroups(entries: ApplicationEntry[], today: string): AttentionGroups {
  const actionable = entries
    .filter(hasOpenNextAction)
    .sort((left, right) => {
      if (!left.nextActionDueDate && right.nextActionDueDate) return 1
      if (left.nextActionDueDate && !right.nextActionDueDate) return -1
      return (left.nextActionDueDate ?? '').localeCompare(right.nextActionDueDate ?? '') ||
        left.company.localeCompare(right.company) || left.title.localeCompare(right.title)
    })
  return {
    overdue: actionable.filter((entry) => entry.nextActionDueDate && entry.nextActionDueDate < today),
    today: actionable.filter((entry) => entry.nextActionDueDate === today),
    upcoming: actionable.filter((entry) => entry.nextActionDueDate && entry.nextActionDueDate > today),
    noDate: actionable.filter((entry) => !entry.nextActionDueDate),
  }
}

/**
 * Roles sitting in an employer stage with no plan yet. They stay listed until you add a next action
 * or finish one after the stage began, so an assessment can't quietly age in the ledger.
 */
export function getStageActions(entries: ApplicationEntry[]): StageAction[] {
  return entries.flatMap((entry): StageAction[] => {
    const status = getCurrentStatus(entry)
    const action = STAGE_ACTIONS[status]
    if (!action || hasOpenNextAction(entry)) return []
    const since = entry.statusHistory.at(-1)?.date ?? entry.submittedDate
    const handledAfterStage = entry.nextActionCompleted && entry.nextActionCompletedAt && entry.nextActionCompletedAt.slice(0, 10) >= since
    return handledAfterStage ? [] : [{ entry, status, action, since }]
  }).sort((left, right) =>
    STAGE_PRIORITY.indexOf(left.status) - STAGE_PRIORITY.indexOf(right.status) || left.since.localeCompare(right.since))
}

export function getRecentResponses(entries: ApplicationEntry[], today: string, days: number): RecentResponse[] {
  const [year, month, day] = today.split('-').map(Number)
  const start = new Date(year, month - 1, day - days)
  const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  return entries
    .flatMap((entry) => entry.statusHistory
      .filter((event) => event.status !== 'applied' && event.date >= from && event.date <= today)
      .map((event) => ({ entry, event })))
    .sort((left, right) => right.event.date.localeCompare(left.event.date) ||
      STAGE_ORDER.indexOf(right.event.status) - STAGE_ORDER.indexOf(left.event.status))
}

const STAGE_ORDER: ApplicationStatus[] = ['applied', 'online_assessment', 'recruiter_screen', 'interview', 'offer', 'rejected', 'withdrawn']

function hasOpenNextAction(entry: ApplicationEntry): boolean {
  return Boolean(entry.nextAction?.trim()) && !entry.nextActionCompleted
}
