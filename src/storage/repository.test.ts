import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApplication } from '../domain/entries'
import { TrackerRepository } from './repository'

describe('TrackerRepository v2', () => {
  let name: string
  let repository: TrackerRepository

  beforeEach(() => {
    name = `paceboard-test-${crypto.randomUUID()}`
    repository = new TrackerRepository(name)
  })

  afterEach(async () => {
    await repository.destroy()
  })

  it('persists singular applications and settings across repository instances', async () => {
    const application = createApplication({
      company: 'Cigna', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick',
    })
    await repository.saveEntry(application)
    await repository.saveSettings({ weeklyTarget: 42, sources: ['Handshake'], lastBackupAt: null })

    const reopened = new TrackerRepository(name)
    expect(await reopened.listEntries()).toEqual([application])
    expect(await reopened.getSettings()).toMatchObject({ weeklyTarget: 42 })
  })

  it('clears v1 aggregate entries during upgrade while preserving settings', async () => {
    await repository.destroy()
    const old = new Dexie(name)
    old.version(1).stores({ entries: 'id, submittedAt, type, source, company, outcome', settings: 'key' })
    await old.table('entries').put({
      id: 'batch', submittedAt: '2026-09-03T12:00:00.000Z', quantity: 7, type: 'quick', updatedAt: '2026-09-03T12:00:00.000Z',
    })
    await old.table('settings').put({ key: 'app', weeklyTarget: 50, sources: ['LinkedIn'], lastBackupAt: null })
    old.close()

    repository = new TrackerRepository(name)
    expect(await repository.listEntries()).toEqual([])
    expect(await repository.getSettings()).toMatchObject({ weeklyTarget: 50, sources: ['LinkedIn'] })
  })

  it('does not change current data when restore validation fails', async () => {
    const original = createApplication({
      company: 'Verisk', title: 'AI Intern', submittedDate: '2026-09-01', effort: 'quick',
    })
    await repository.saveEntry(original)

    await expect(repository.restoreFromJson('{"broken":true}')).rejects.toThrow()
    expect(await repository.listEntries()).toEqual([original])
  })
})
