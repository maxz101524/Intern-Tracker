import type {
  ApplicationEntry,
  AppSettings,
  TrackerBackup,
} from './types'
import { createEntry } from './entries'

export function buildBackup(
  entries: ApplicationEntry[],
  settings: AppSettings,
  exportedAt?: string,
): TrackerBackup {
  return {
    version: 1,
    exportedAt: exportedAt ?? new Date().toISOString(),
    entries,
    settings,
  }
}

export function parseBackup(_raw: string): TrackerBackup {
  try {
    const data: unknown = JSON.parse(_raw)
    if (!isRecord(data) || data.version !== 1) throw new Error()
    if (!Array.isArray(data.entries) || !validSettings(data.settings)) {
      throw new Error()
    }

    const entries = data.entries.map((candidate) => {
      if (!isRecord(candidate)) throw new Error()
      return createEntry(candidate as unknown as ApplicationEntry)
    })

    return {
      version: 1,
      exportedAt:
        typeof data.exportedAt === 'string'
          ? data.exportedAt
          : new Date().toISOString(),
      entries,
      settings: data.settings,
    }
  } catch {
    throw new Error('This file is not a valid Paceboard backup.')
  }
}

export function entriesToCsv(_entries: ApplicationEntry[]): string {
  const columns: (keyof ApplicationEntry)[] = [
    'id',
    'submittedAt',
    'quantity',
    'type',
    'source',
    'company',
    'title',
    'url',
    'resumeVariant',
    'outcome',
    'notes',
    'updatedAt',
  ]
  const rows = _entries.map((entry) =>
    columns.map((column) => csvCell(entry[column])).join(','),
  )
  return [columns.join(','), ...rows].join('\n')
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validSettings(value: unknown): value is AppSettings {
  if (!isRecord(value)) return false
  return (
    Number.isInteger(value.weeklyTarget) &&
    Number(value.weeklyTarget) >= 0 &&
    Array.isArray(value.sources) &&
    value.sources.every((source) => typeof source === 'string') &&
    (value.lastBackupAt === null || typeof value.lastBackupAt === 'string')
  )
}
