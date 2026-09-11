import type { ApplicationEntry } from './types'

export interface RestoreConflict {
  backup: ApplicationEntry
  current: ApplicationEntry
}

export type RestoreChoices = Record<string, 'current' | 'backup'>

export function findRestoreConflicts(current: ApplicationEntry[], backup: ApplicationEntry[]): RestoreConflict[] {
  return backup.flatMap((incoming) => {
    const match = current.find((entry) => entry.id === incoming.id || identity(entry) === identity(incoming))
    return match ? [{ backup: incoming, current: match }] : []
  })
}

export function mergeApplicationEntries(
  current: ApplicationEntry[],
  backup: ApplicationEntry[],
  choices: RestoreChoices = {},
): ApplicationEntry[] {
  const merged = [...current]
  for (const incoming of backup) {
    const index = merged.findIndex((entry) => entry.id === incoming.id || identity(entry) === identity(incoming))
    if (index < 0) {
      merged.push(incoming)
    } else if (choices[incoming.id] === 'backup') {
      merged[index] = incoming
    }
  }
  return merged
}

function identity(entry: ApplicationEntry): string {
  return `${normalize(entry.company)}|${normalize(entry.title)}|${entry.submittedDate}`
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}
