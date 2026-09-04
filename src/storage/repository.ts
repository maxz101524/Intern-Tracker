import Dexie, { type EntityTable } from 'dexie'
import { parseBackup } from '../domain/backup'
import type { ApplicationEntry, AppSettings } from '../domain/types'

const defaultSettings: AppSettings = {
  weeklyTarget: 0,
  sources: ['LinkedIn', 'Handshake', 'Company site', 'Simplify', 'Career fair', 'Referral'],
  lastBackupAt: null,
}

interface SettingsRow extends AppSettings { key: 'app' }

interface TrackerDatabase extends Dexie {
  entries: EntityTable<ApplicationEntry, 'id'>
  settings: EntityTable<SettingsRow, 'key'>
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
    this.db.entries = this.db.table('entries')
    this.db.settings = this.db.table('settings')
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

  async restoreFromJson(raw: string): Promise<void> {
    const backup = parseBackup(raw)
    await this.db.transaction('rw', this.db.entries, this.db.settings, async () => {
      await this.db.entries.clear()
      await this.db.entries.bulkAdd(backup.entries)
      await this.db.settings.put({ key: 'app', ...backup.settings })
    })
  }

  async reset(): Promise<void> {
    await this.db.transaction('rw', this.db.entries, this.db.settings, async () => {
      await this.db.entries.clear()
      await this.db.settings.clear()
    })
  }

  async destroy(): Promise<void> {
    this.db.close()
    await Dexie.delete(this.db.name)
  }
}

export const trackerRepository = new TrackerRepository()
