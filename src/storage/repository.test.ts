import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TrackerRepository } from './repository'
import { createEntry } from '../domain/entries'

describe('TrackerRepository', () => {
  let repository: TrackerRepository

  beforeEach(async () => {
    repository = new TrackerRepository(`paceboard-test-${crypto.randomUUID()}`)
    await repository.reset()
  })

  afterEach(async () => {
    await repository.destroy()
  })

  it('persists entries and settings across repository instances', async () => {
    const application = createEntry({
      submittedAt: '2026-09-03T12:00:00.000Z',
      quantity: 3,
      type: 'quick',
    })

    await repository.saveEntry(application)
    await repository.saveSettings({
      weeklyTarget: 42,
      sources: ['Handshake'],
      lastBackupAt: null,
    })

    expect(await repository.listEntries()).toEqual([application])
    expect(await repository.getSettings()).toMatchObject({ weeklyTarget: 42 })
  })

  it('replaces a batch atomically when splitting out a detailed entry', async () => {
    const batch = createEntry({
      submittedAt: '2026-09-03T12:00:00.000Z',
      quantity: 3,
      type: 'quick',
    })
    await repository.saveEntry(batch)

    await repository.splitBatch(batch.id, {
      company: 'Acme',
      title: 'Data Intern',
    })

    const entries = await repository.listEntries()
    expect(entries.map(({ quantity }) => quantity).sort()).toEqual([1, 2])
    expect(entries.reduce((sum, item) => sum + item.quantity, 0)).toBe(3)
    expect(entries.some(({ company }) => company === 'Acme')).toBe(true)
  })

  it('does not change current data when restore validation fails', async () => {
    const original = createEntry({
      submittedAt: '2026-09-03T12:00:00.000Z',
      quantity: 1,
      type: 'quick',
    })
    await repository.saveEntry(original)

    await expect(repository.restoreFromJson('{"broken":true}')).rejects.toThrow()

    expect(await repository.listEntries()).toEqual([original])
  })
})
