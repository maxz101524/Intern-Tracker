import Dexie, { type EntityTable } from 'dexie'
import { parseBackup } from '../domain/backup'
import { emptyGmailImportData } from '../domain/gmail'
import { mergeApplicationEntries, type RestoreChoices } from '../domain/restore'
import { normalizeSettings } from '../domain/settings'
import type {
  ApplicationEntry,
  AppSettings,
  GmailCandidate,
  GmailCandidateState,
  GmailImportData,
  GmailSyncState,
  ProcessedGmailMessage,
} from '../domain/types'

interface SettingsRow extends AppSettings { key: 'app' }

interface TrackerDatabase extends Dexie {
  entries: EntityTable<ApplicationEntry, 'id'>
  settings: EntityTable<SettingsRow, 'key'>
  gmailCandidates: EntityTable<GmailCandidate, 'messageId'>
  processedGmailMessages: EntityTable<ProcessedGmailMessage, 'messageId'>
  gmailSync: EntityTable<GmailSyncState, 'key'>
}

export interface GmailSyncCommit {
  candidates: GmailCandidate[]
  processedMessages: ProcessedGmailMessage[]
  syncState: GmailSyncState
}

export interface GmailCandidateReview {
  candidate: GmailCandidate
  disposition: 'imported' | 'dismissed'
  application?: ApplicationEntry
  linkedEntryId?: string
  reviewedAt: string
}

export class TrackerRepository {
  private readonly db: TrackerDatabase

  constructor(name = 'paceboard') {
    this.db = new Dexie(name) as TrackerDatabase
    this.db.version(1).stores({
      entries: 'id, submittedAt, type, source, company, outcome',
      settings: 'key',
    })
    this.db.version(2).stores({
      entries: 'id, submittedDate, effort, source, company, updatedAt',
      settings: 'key',
    }).upgrade(async (transaction) => {
      await transaction.table('entries').clear()
    })
    this.db.version(3).stores({
      entries: 'id, submittedDate, effort, source, company, updatedAt, origin.messageId',
      settings: 'key',
      gmailCandidates: 'messageId, state, submittedDate, createdAt',
      processedGmailMessages: 'messageId, disposition, processedAt',
      gmailSync: 'key',
    })
    this.db.version(4).stores({
      entries: 'id, submittedDate, effort, source, company, updatedAt, origin.messageId',
      settings: 'key',
      gmailCandidates: 'messageId, state, kind, submittedDate, createdAt',
      processedGmailMessages: 'messageId, disposition, processedAt',
      gmailSync: 'key',
    })
    this.db.entries = this.db.table('entries')
    this.db.settings = this.db.table('settings')
    this.db.gmailCandidates = this.db.table('gmailCandidates')
    this.db.processedGmailMessages = this.db.table('processedGmailMessages')
    this.db.gmailSync = this.db.table('gmailSync')
  }

  async listEntries(): Promise<ApplicationEntry[]> {
    const entries = await this.db.entries.toArray()
    return entries.sort((a, b) =>
      b.submittedDate.localeCompare(a.submittedDate) || b.updatedAt.localeCompare(a.updatedAt),
    )
  }

  async saveEntry(entry: ApplicationEntry): Promise<void> {
    await this.saveEntries([entry])
  }

  async saveEntries(entries: ApplicationEntry[]): Promise<void> {
    if (!entries.length) return
    await this.db.transaction('rw', this.db.entries, this.db.settings, async () => {
      await this.db.entries.bulkPut(entries)
      await this.bumpChanges(entries.length)
    })
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.entries, this.db.settings, async () => {
      await this.db.entries.delete(id)
      await this.bumpChanges()
    })
  }

  async getSettings(): Promise<AppSettings> {
    const row = await this.db.settings.get('app')
    return normalizeSettings(row)
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.db.transaction('rw', this.db.settings, async () => {
      const current = normalizeSettings(await this.db.settings.get('app'))
      const next = normalizeSettings(settings)
      await this.db.settings.put({ ...next, key: 'app', changeCount: current.changeCount + 1 })
    })
  }

  async markBackup(exportedAt: string): Promise<AppSettings> {
    const current = normalizeSettings(await this.db.settings.get('app'))
    const next = { ...current, lastBackupAt: exportedAt, lastBackupChangeCount: current.changeCount }
    await this.db.settings.put({ key: 'app', ...next })
    return next
  }

  async listGmailCandidates(state?: GmailCandidateState): Promise<GmailCandidate[]> {
    const candidates = state
      ? await this.db.gmailCandidates.where('state').equals(state).toArray()
      : await this.db.gmailCandidates.toArray()
    return candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async getGmailCandidate(messageId: string): Promise<GmailCandidate | undefined> {
    return this.db.gmailCandidates.get(messageId)
  }

  async saveGmailCandidate(candidate: GmailCandidate): Promise<void> {
    await this.db.transaction('rw', this.db.gmailCandidates, this.db.settings, async () => {
      await this.db.gmailCandidates.put(candidate)
      await this.bumpChanges()
    })
  }

  async listProcessedGmailMessages(): Promise<ProcessedGmailMessage[]> {
    const messages = await this.db.processedGmailMessages.toArray()
    return messages.sort((a, b) => a.processedAt.localeCompare(b.processedAt))
  }

  async hasProcessedGmailMessage(messageId: string): Promise<boolean> {
    return (await this.db.processedGmailMessages.get(messageId)) !== undefined
  }

  async saveProcessedGmailMessage(message: ProcessedGmailMessage): Promise<void> {
    await this.db.processedGmailMessages.put(message)
  }

  async getGmailSyncState(): Promise<GmailSyncState> {
    return await this.db.gmailSync.get('gmail') ?? emptyGmailImportData().syncState
  }

  async saveGmailSyncState(state: GmailSyncState): Promise<void> {
    await this.db.gmailSync.put(state)
  }

  async getGmailImportData(): Promise<GmailImportData> {
    const [candidates, processedMessages, syncState] = await Promise.all([
      this.listGmailCandidates(),
      this.listProcessedGmailMessages(),
      this.getGmailSyncState(),
    ])
    return { candidates, processedMessages, syncState }
  }

  async commitGmailSync(result: GmailSyncCommit): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.gmailCandidates,
      this.db.processedGmailMessages,
      this.db.gmailSync,
      this.db.settings,
      async () => {
        await this.db.gmailCandidates.bulkPut(result.candidates)
        await this.db.processedGmailMessages.bulkPut(result.processedMessages)
        await this.db.gmailSync.put(result.syncState)
        if (result.candidates.length) await this.bumpChanges(result.candidates.length)
      },
    )
  }

  async reviewGmailCandidate(review: GmailCandidateReview): Promise<void> {
    if (review.disposition === 'imported' && !review.application) {
      throw new Error('An imported Gmail candidate requires an application.')
    }
    const candidate: GmailCandidate = {
      ...review.candidate,
      linkedEntryId: review.linkedEntryId ?? review.candidate.linkedEntryId,
      state: review.disposition,
      reviewedAt: review.reviewedAt,
    }
    const processed: ProcessedGmailMessage = {
      messageId: review.candidate.messageId,
      disposition: review.disposition,
      processedAt: review.reviewedAt,
    }
    await this.db.transaction(
      'rw',
      this.db.entries,
      this.db.gmailCandidates,
      this.db.processedGmailMessages,
      this.db.settings,
      async () => {
        if (review.application) await this.db.entries.put(review.application)
        await this.db.gmailCandidates.put(candidate)
        await this.db.processedGmailMessages.put(processed)
        await this.bumpChanges()
      },
    )
  }

  async restoreGmailCandidate(candidate: GmailCandidate): Promise<void> {
    const restored: GmailCandidate = { ...candidate, state: 'pending' }
    delete restored.reviewedAt
    delete restored.linkedEntryId
    await this.db.transaction(
      'rw', this.db.gmailCandidates, this.db.processedGmailMessages, this.db.settings,
      async () => {
        await this.db.gmailCandidates.put(restored)
        await this.db.processedGmailMessages.put({
          messageId: candidate.messageId,
          disposition: 'candidate',
          processedAt: new Date().toISOString(),
        })
        await this.bumpChanges()
      },
    )
  }

  async resetGmailImportHistory(): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.gmailCandidates,
      this.db.processedGmailMessages,
      this.db.gmailSync,
      async () => {
        await this.db.gmailCandidates.clear()
        await this.db.processedGmailMessages.clear()
        await this.db.gmailSync.clear()
      },
    )
  }

  async restoreFromJson(
    raw: string,
    mode: 'merge' | 'replace' = 'replace',
    choices: RestoreChoices = {},
  ): Promise<void> {
    const backup = parseBackup(raw)
    const currentEntries = mode === 'merge' ? await this.db.entries.toArray() : []
    const currentGmail = mode === 'merge' ? await this.getGmailImportData() : emptyGmailImportData()
    const currentSettings = mode === 'merge' ? normalizeSettings(await this.db.settings.get('app')) : normalizeSettings(backup.settings)
    const entries = mode === 'merge'
      ? mergeApplicationEntries(currentEntries, backup.entries, choices)
      : backup.entries
    const gmail = mode === 'merge' ? mergeGmailData(currentGmail, backup.gmail) : backup.gmail
    await this.db.transaction(
      'rw',
      this.db.entries,
      this.db.settings,
      this.db.gmailCandidates,
      this.db.processedGmailMessages,
      this.db.gmailSync,
      async () => {
      await this.db.entries.clear()
      await this.db.gmailCandidates.clear()
      await this.db.processedGmailMessages.clear()
      await this.db.gmailSync.clear()
      await this.db.entries.bulkPut(entries)
      await this.db.settings.put({ key: 'app', ...currentSettings })
      await this.db.gmailCandidates.bulkPut(gmail.candidates)
      await this.db.processedGmailMessages.bulkPut(gmail.processedMessages)
      await this.db.gmailSync.put(gmail.syncState)
      },
    )
  }

  async reset(): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.entries,
      this.db.settings,
      this.db.gmailCandidates,
      this.db.processedGmailMessages,
      this.db.gmailSync,
      async () => {
      await this.db.entries.clear()
      await this.db.settings.clear()
      await this.db.gmailCandidates.clear()
      await this.db.processedGmailMessages.clear()
      await this.db.gmailSync.clear()
      },
    )
  }

  async destroy(): Promise<void> {
    this.db.close()
    await Dexie.delete(this.db.name)
  }

  private async bumpChanges(amount = 1): Promise<void> {
    const current = normalizeSettings(await this.db.settings.get('app'))
    await this.db.settings.put({ key: 'app', ...current, changeCount: current.changeCount + amount })
  }
}

function mergeGmailData(current: GmailImportData, backup: GmailImportData): GmailImportData {
  const byId = <T extends { messageId: string }>(left: T[], right: T[]) =>
    [...new Map([...right, ...left].map((item) => [item.messageId, item])).values()]
  return {
    candidates: byId(current.candidates, backup.candidates),
    processedMessages: byId(current.processedMessages, backup.processedMessages),
    syncState: current.syncState.initialSyncCompleted ? current.syncState : backup.syncState,
  }
}

export const trackerRepository = new TrackerRepository()
