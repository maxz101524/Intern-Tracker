import Dexie, { type EntityTable } from 'dexie'
import { parseBackup } from '../domain/backup'
import { splitBatchEntry } from '../domain/entries'
import type {
  ApplicationEntry,
  AppSettings,
  EntryDetails,
} from '../domain/types'

const defaultSettings: AppSettings = {
  weeklyTarget: 0,
  sources: ['LinkedIn', 'Handshake', 'Company site', 'Simplify', 'Referral'],
  lastBackupAt: null,
}

interface SettingsRow extends AppSettings {
  key: 'app'
}

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
    this.db.entries = this.db.table('entries')
    this.db.settings = this.db.table('settings')
  }

  async listEntries(): Promise<ApplicationEntry[]> {
    return this.db.entries.orderBy('submittedAt').reverse().toArray()
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
    return {
      weeklyTarget: row.weeklyTarget,
      sources: row.sources,
      lastBackupAt: row.lastBackupAt,
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.db.settings.put({ key: 'app', ...settings })
  }

  async splitBatch(id: string, details: EntryDetails): Promise<void> {
    await this.db.transaction('rw', this.db.entries, async () => {
      const entry = await this.db.entries.get(id)
      if (!entry) throw new Error('Application entry not found.')
      const { remainingBatch, detailedEntry } = splitBatchEntry(entry, details)
      if (remainingBatch) await this.db.entries.put(remainingBatch)
      else await this.db.entries.delete(id)
      await this.db.entries.put(detailedEntry)
    })
  }

  async restoreFromJson(raw: string): Promise<void> {
    const backup = parseBackup(raw)
    await this.db.transaction(
      'rw',
      this.db.entries,
      this.db.settings,
      async () => {
        await this.db.entries.clear()
        await this.db.entries.bulkAdd(backup.entries)
        await this.db.settings.put({ key: 'app', ...backup.settings })
      },
    )
  }

  async reset(): Promise<void> {
    await this.db.transaction(
      'rw',
      this.db.entries,
      this.db.settings,
      async () => {
        await this.db.entries.clear()
        await this.db.settings.clear()
      },
    )
  }

  async destroy(): Promise<void> {
    this.db.close()
    await Dexie.delete(this.db.name)
  }
}

export const trackerRepository = new TrackerRepository()
