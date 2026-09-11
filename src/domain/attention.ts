import type { ApplicationEntry } from './types'

export interface AttentionGroups {
  overdue: ApplicationEntry[]
  today: ApplicationEntry[]
  upcoming: ApplicationEntry[]
}

export function getAttentionGroups(entries: ApplicationEntry[], today: string): AttentionGroups {
  const actionable = entries
    .filter((entry) => entry.nextAction && entry.nextActionDueDate && !entry.nextActionCompleted)
    .sort((left, right) =>
      left.nextActionDueDate!.localeCompare(right.nextActionDueDate!) ||
      left.company.localeCompare(right.company),
    )
  return {
    overdue: actionable.filter((entry) => entry.nextActionDueDate! < today),
    today: actionable.filter((entry) => entry.nextActionDueDate === today),
    upcoming: actionable.filter((entry) => entry.nextActionDueDate! > today),
  }
}
