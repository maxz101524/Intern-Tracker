import type { ApplicationEntry } from './types'

export interface AttentionGroups {
  overdue: ApplicationEntry[]
  today: ApplicationEntry[]
  upcoming: ApplicationEntry[]
  noDate: ApplicationEntry[]
}

export function getAttentionGroups(entries: ApplicationEntry[], today: string): AttentionGroups {
  const actionable = entries
    .filter((entry) => entry.nextAction?.trim() && !entry.nextActionCompleted)
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
