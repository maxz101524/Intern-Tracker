import { createApplication } from './entries'
import {
  createGmailCandidate,
  createGmailSyncState,
  createProcessedGmailMessage,
  emptyGmailImportData,
} from './gmail'
import { normalizeSettings } from './settings'
import { getDisplayStatus, statusLabel, todayDate } from './status'
import type { ApplicationEntry, ApplicationInput, AppSettings, GmailImportData, MuseData, MuseItem, TrackerBackup } from './types'

export function buildBackup(
  entries: ApplicationEntry[],
  settings: AppSettings,
  exportedAt?: string,
): TrackerBackup

export function buildBackup(
  entries: ApplicationEntry[],
  settings: AppSettings,
  gmail: GmailImportData,
  exportedAt?: string,
  muse?: MuseData,
): TrackerBackup

export function buildBackup(
  entries: ApplicationEntry[],
  settings: AppSettings,
  gmailOrExportedAt: GmailImportData | string = emptyGmailImportData(),
  maybeExportedAt?: string,
  muse?: MuseData,
): TrackerBackup {
  const gmail = typeof gmailOrExportedAt === 'string' ? emptyGmailImportData() : gmailOrExportedAt
  const exportedAt = typeof gmailOrExportedAt === 'string'
    ? gmailOrExportedAt
    : maybeExportedAt ?? new Date().toISOString()
  const backup: TrackerBackup = { version: 4, exportedAt, entries, settings: normalizeSettings(settings), gmail }
  if (muse) backup.muse = muse
  return backup
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
    if (!isRecord(data) || ![2, 3, 4].includes(Number(data.version))) throw new Error()
    if (!Array.isArray(data.entries) || !validSettings(data.settings)) throw new Error()
    const entries = data.entries.map((candidate) => {
      if (!isRecord(candidate)) throw new Error()
      return createApplication(candidate as unknown as ApplicationInput)
    })
    const backup: TrackerBackup = {
      version: 4,
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : new Date().toISOString(),
      entries,
      settings: normalizeSettings(data.settings),
      gmail: data.version === 2 ? emptyGmailImportData() : validGmailImportData(data.gmail),
    }
    if (data.muse !== undefined) backup.muse = validMuseData(data.muse)
    return backup
  } catch {
    throw new Error('This file is not a valid Paceboard backup.')
  }
}

export function entriesToCsv(entries: ApplicationEntry[], today = todayDate()): string {
  const columns = [
    'id', 'company', 'title', 'submittedDate', 'effort', 'source', 'currentStatus',
    'statusHistory', 'originProvider', 'originMessageId', 'url', 'resumeVariant', 'nextAction',
    'nextActionDueDate', 'nextActionCompleted', 'jobDescriptionExcerpt', 'notes', 'postedDate', 'updatedAt',
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
      entry.origin?.provider,
      entry.origin?.messageId,
      entry.url,
      entry.resumeVariant,
      entry.nextAction,
      entry.nextActionDueDate,
      entry.nextActionCompleted,
      entry.jobDescriptionExcerpt,
      entry.notes,
      entry.postedDate,
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
    (value.lastBackupAt === null || value.lastBackupAt === undefined || typeof value.lastBackupAt === 'string')
}

function validMuseData(value: unknown): MuseData {
  if (!isRecord(value) || !Array.isArray(value.items) || !isRecord(value.syncState) || value.syncState.key !== 'muse') {
    throw new Error()
  }
  const items = value.items.map((item) => {
    if (!isRecord(item) || typeof item.key !== 'string' || !['entry', 'status'].includes(String(item.kind)) ||
      !['applied', 'pending', 'dismissed', 'skipped'].includes(String(item.state)) || !isRecord(item.payload) ||
      typeof item.batchId !== 'string' || typeof item.streamId !== 'string' || typeof item.receivedAt !== 'string') {
      throw new Error()
    }
    return item as unknown as MuseItem
  })
  const syncState = Object.fromEntries(Object.entries(value.syncState).filter(([key, field]) =>
    key === 'key' || key === 'retentionGap' ? true : typeof field === 'string'))
  if (value.decisions !== undefined && (!Array.isArray(value.decisions) || value.decisions.some((decision) =>
    !isRecord(decision) || typeof decision.id !== 'string' || !['open', 'answered', 'closed'].includes(String(decision.state)) || !isRecord(decision.payload)))) {
    throw new Error()
  }
  const muse: MuseData = { items, syncState: syncState as unknown as MuseData['syncState'] }
  if (value.decisions !== undefined) muse.decisions = value.decisions as MuseData['decisions']
  return muse
}

function validGmailImportData(value: unknown): GmailImportData {
  if (!isRecord(value) || !Array.isArray(value.candidates) || !Array.isArray(value.processedMessages) || !isRecord(value.syncState)) {
    throw new Error()
  }
  return {
    candidates: value.candidates.map((candidate) => {
      if (!isRecord(candidate)) throw new Error()
      return createGmailCandidate(candidate as unknown as Parameters<typeof createGmailCandidate>[0])
    }),
    processedMessages: value.processedMessages.map((message) => {
      if (!isRecord(message)) throw new Error()
      return createProcessedGmailMessage(message as unknown as Parameters<typeof createProcessedGmailMessage>[0])
    }),
    syncState: createGmailSyncState(value.syncState),
  }
}
