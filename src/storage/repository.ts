import Dexie, { type EntityTable } from 'dexie'
import { compareStreamIds } from '../../shared/museContract'
import { parseBackup } from '../domain/backup'
import { emptyGmailImportData } from '../domain/gmail'
import { emptyMuseData } from '../domain/muse'
import { mergeApplicationEntries, type RestoreChoices } from '../domain/restore'
import { normalizeSettings } from '../domain/settings'
import type {
  ApplicationEntry,
  AppSettings,
  GmailCandidate,
  GmailCandidateState,
  GmailImportData,
  GmailSyncState,
  MuseData,
  MuseItem,
  MuseSyncState,
  ProcessedGmailMessage,
} from '../domain/types'

interface SettingsRow extends AppSettings { key: 'app' }

interface TrackerDatabase extends Dexie {
  entries: EntityTable<ApplicationEntry, 'id'>
  settings: EntityTable<SettingsRow, 'key'>
  gmailCandidates: EntityTable<GmailCandidate, 'messageId'>
  processedGmailMessages: EntityTable<ProcessedGmailMessage, 'messageId'>
  gmailSync: EntityTable<GmailSyncState, 'key'>
  museItems: EntityTable<MuseItem, 'key'>
  museSync: EntityTable<MuseSyncState, 'key'>
}

export interface GmailSyncCommit {
  candidates: GmailCandidate[]
  processedMessages: ProcessedGmailMessage[]
  syncState: GmailSyncState
  removedCandidateIds?: string[]
}

export interface MuseIngestCommit {
  items: MuseItem[]
  entryWrites: ApplicationEntry[]
  gmailResolutions: GmailCandidate[]
  syncState: MuseSyncState
}

export interface MuseItemReview {
  item: MuseItem
  entryWrites?: ApplicationEntry[]
  deleteEntryIds?: string[]
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
    this.db.version(5).stores({
      entries: 'id, submittedDate, effort, source, company, updatedAt, origin.messageId',
      settings: 'key',
      gmailCandidates: 'messageId, state, kind, submittedDate, createdAt',
      processedGmailMessages: 'messageId, disposition, processedAt',
      gmailSync: 'key',
      museItems: 'key, state, kind, receivedAt',
      museSync: 'key',
    })
    this.db.entries = this.db.table('entries')
    this.db.settings = this.db.table('settings')
    this.db.gmailCandidates = this.db.table('gmailCandidates')
    this.db.processedGmailMessages = this.db.table('processedGmailMessages')
    this.db.gmailSync = this.db.table('gmailSync')
    this.db.museItems = this.db.table('museItems')
    this.db.museSync = this.db.table('museSync')
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
        if (result.removedCandidateIds?.length) await this.db.gmailCandidates.bulkDelete(result.removedCandidateIds)
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

  async getMuseData(): Promise<MuseData> {
    const [items, syncState] = await Promise.all([this.db.museItems.toArray(), this.db.museSync.get('muse')])
    return { items: sortMuseItems(items), syncState: syncState ?? emptyMuseData().syncState }
  }

  async saveMuseSyncState(state: MuseSyncState): Promise<void> {
    await this.db.museSync.put(state)
  }

  async patchMuseSyncState(patch: Partial<Omit<MuseSyncState, 'key'>>): Promise<MuseSyncState> {
    return this.db.transaction('rw', this.db.museSync, async () => {
      const next = { ...(await this.db.museSync.get('muse') ?? emptyMuseData().syncState), ...patch, key: 'muse' as const }
      await this.db.museSync.put(next)
      return next
    })
  }

  async commitMuseIngest(commit: MuseIngestCommit): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.entries, this.db.museItems, this.db.museSync, this.db.gmailCandidates, this.db.processedGmailMessages, this.db.settings],
      async () => {
        await this.db.entries.bulkPut(commit.entryWrites)
        await this.db.museItems.bulkPut(commit.items)
        await this.db.gmailCandidates.bulkPut(commit.gmailResolutions)
        await this.db.processedGmailMessages.bulkPut(commit.gmailResolutions.map((candidate) => ({
          messageId: candidate.messageId,
          disposition: 'imported' as const,
          processedAt: candidate.reviewedAt ?? new Date().toISOString(),
        })))
        await this.db.museSync.put(commit.syncState)
        const changes = commit.entryWrites.length + commit.gmailResolutions.length
        if (changes) await this.bumpChanges(changes)
      },
    )
  }

  async reviewMuseItem(review: MuseItemReview): Promise<void> {
    await this.db.transaction('rw', this.db.entries, this.db.museItems, this.db.settings, async () => {
      if (review.deleteEntryIds?.length) await this.db.entries.bulkDelete(review.deleteEntryIds)
      if (review.entryWrites?.length) await this.db.entries.bulkPut(review.entryWrites)
      await this.db.museItems.put(review.item)
      await this.bumpChanges()
    })
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
    const backupMuse = backup.muse ?? emptyMuseData()
    const muse = mode === 'merge' ? mergeMuseData(await this.getMuseData(), backupMuse) : backupMuse
    await this.db.transaction(
      'rw',
      [this.db.entries, this.db.settings, this.db.gmailCandidates, this.db.processedGmailMessages, this.db.gmailSync, this.db.museItems, this.db.museSync],
      async () => {
      await this.db.entries.clear()
      await this.db.gmailCandidates.clear()
      await this.db.processedGmailMessages.clear()
      await this.db.gmailSync.clear()
      await this.db.museItems.clear()
      await this.db.museSync.clear()
      await this.db.entries.bulkPut(entries)
      await this.db.settings.put({ key: 'app', ...currentSettings })
      await this.db.gmailCandidates.bulkPut(gmail.candidates)
      await this.db.processedGmailMessages.bulkPut(gmail.processedMessages)
      await this.db.gmailSync.put(gmail.syncState)
      await this.db.museItems.bulkPut(muse.items)
      await this.db.museSync.put(muse.syncState)
      },
    )
  }

  async reset(): Promise<void> {
    await this.db.transaction(
      'rw',
      [this.db.entries, this.db.settings, this.db.gmailCandidates, this.db.processedGmailMessages, this.db.gmailSync, this.db.museItems, this.db.museSync],
      async () => {
      await this.db.entries.clear()
      await this.db.settings.clear()
      await this.db.gmailCandidates.clear()
      await this.db.processedGmailMessages.clear()
      await this.db.gmailSync.clear()
      await this.db.museItems.clear()
      await this.db.museSync.clear()
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

function mergeMuseData(current: MuseData, backup: MuseData): MuseData {
  const items = [...new Map([...backup.items, ...current.items].map((item) => [item.key, item])).values()]
  const currentCursor = current.syncState.cursor
  const backupCursor = backup.syncState.cursor
  const syncState = !backupCursor || (currentCursor && compareStreamIds(currentCursor, backupCursor) >= 0)
    ? current.syncState
    : { ...current.syncState, cursor: backupCursor, lastPulledAt: backup.syncState.lastPulledAt }
  return { items: sortMuseItems(items), syncState }
}

function sortMuseItems(items: MuseItem[]): MuseItem[] {
  return [...items].sort((a, b) =>
    a.receivedAt.localeCompare(b.receivedAt) || compareStreamIds(a.streamId, b.streamId) ||
    (a.kind === b.kind ? 0 : a.kind === 'entry' ? -1 : 1))
}

export const trackerRepository = new TrackerRepository()
