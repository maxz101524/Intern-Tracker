import Dexie, { type EntityTable } from 'dexie'
import { parseBackup } from '../domain/backup'
import { emptyGmailImportData } from '../domain/gmail'
import type {
  ApplicationEntry,
  AppSettings,
  GmailCandidate,
  GmailCandidateState,
  GmailImportData,
  GmailSyncState,
  ProcessedGmailMessage,
} from '../domain/types'

const defaultSettings: AppSettings = {
  weeklyTarget: 0,
  sources: ['LinkedIn', 'Handshake', 'Company site', 'Simplify', 'Career fair', 'Referral'],
  lastBackupAt: null,
}

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
    await this.db.entries.put(entry)
  }

  async deleteEntry(id: string): Promise<void> {
    await this.db.entries.delete(id)
  }

  async getSettings(): Promise<AppSettings> {
    const row = await this.db.settings.get('app')
    if (!row) return { ...defaultSettings, sources: [...defaultSettings.sources] }
    return { weeklyTarget: row.weeklyTarget, sources: row.sources, lastBackupAt: row.lastBackupAt }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.db.settings.put({ key: 'app', ...settings })
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
    await this.db.gmailCandidates.put(candidate)
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
      async () => {
        await this.db.gmailCandidates.bulkPut(result.candidates)
        await this.db.processedGmailMessages.bulkPut(result.processedMessages)
        await this.db.gmailSync.put(result.syncState)
      },
    )
  }

  async reviewGmailCandidate(review: GmailCandidateReview): Promise<void> {
    if (review.disposition === 'imported' && !review.application) {
      throw new Error('An imported Gmail candidate requires an application.')
    }
    const candidate: GmailCandidate = {
      ...review.candidate,
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
      async () => {
        if (review.application) await this.db.entries.put(review.application)
        await this.db.gmailCandidates.put(candidate)
        await this.db.processedGmailMessages.put(processed)
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

  async restoreFromJson(raw: string): Promise<void> {
    const backup = parseBackup(raw)
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
      await this.db.entries.bulkPut(backup.entries)
      await this.db.settings.put({ key: 'app', ...backup.settings })
      await this.db.gmailCandidates.bulkPut(backup.gmail.candidates)
      await this.db.processedGmailMessages.bulkPut(backup.gmail.processedMessages)
      await this.db.gmailSync.put(backup.gmail.syncState)
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
}

export const trackerRepository = new TrackerRepository()
