import { createApplication } from './entries'
import { getDisplayStatus, statusLabel, todayDate } from './status'
import type { ApplicationEntry, ApplicationInput, AppSettings, TrackerBackup } from './types'

export function buildBackup(
  entries: ApplicationEntry[],
  settings: AppSettings,
  exportedAt = new Date().toISOString(),
): TrackerBackup {
  return { version: 2, exportedAt, entries, settings }
}

export function parseBackup(raw: string): TrackerBackup {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('This file is not a valid Paceboard backup.')
  }

  if (isRecord(data) && data.version === 1) {
    throw new Error('Paceboard v1 backups cannot be restored into the singular-role tracker.')
  }

  try {
    if (!isRecord(data) || data.version !== 2) throw new Error()
    if (!Array.isArray(data.entries) || !validSettings(data.settings)) throw new Error()
    const entries = data.entries.map((candidate) => {
      if (!isRecord(candidate)) throw new Error()
      return createApplication(candidate as unknown as ApplicationInput)
    })
    return {
      version: 2,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
      entries,
      settings: data.settings,
    }
  } catch {
    throw new Error('This file is not a valid Paceboard backup.')
  }
}

export function entriesToCsv(entries: ApplicationEntry[], today = todayDate()): string {
  const columns = [
    'id', 'company', 'title', 'submittedDate', 'effort', 'source', 'currentStatus',
    'statusHistory', 'url', 'resumeVariant', 'notes', 'updatedAt',
  ]
  const rows = entries.map((entry) => {
    const values: unknown[] = [
      entry.id,
      entry.company,
      entry.title,
      entry.submittedDate,
      entry.effort,
      entry.source,
      statusLabel(getDisplayStatus(entry, today)),
      entry.statusHistory.map((event) => `${event.date}:${statusLabel(event.status)}`).join(' | '),
      entry.url,
      entry.resumeVariant,
      entry.notes,
      entry.updatedAt,
    ]
    return values.map(csvCell).join(',')
  })
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
  return Number.isInteger(value.weeklyTarget) && Number(value.weeklyTarget) >= 0 &&
    Array.isArray(value.sources) && value.sources.every((source) => typeof source === 'string') &&
    (value.lastBackupAt === null || typeof value.lastBackupAt === 'string')
}
