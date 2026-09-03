import { describe, expect, it } from 'vitest'
import { buildBackup, entriesToCsv, parseBackup } from './backup'
import { createEntry } from './entries'
import type { AppSettings } from './types'

const settings: AppSettings = {
  weeklyTarget: 35,
  sources: ['LinkedIn', 'Company site'],
  lastBackupAt: null,
}

describe('backup and export', () => {
  it('round-trips the full dataset through a versioned JSON backup', () => {
    const entries = [
      createEntry({
        submittedAt: '2026-09-03T12:00:00.000Z',
        quantity: 1,
        type: 'targeted',
        company: 'Acme',
        title: 'ML Intern',
      }),
    ]

    const backup = buildBackup(entries, settings, '2026-09-03T14:00:00.000Z')
    const restored = parseBackup(JSON.stringify(backup))

    expect(restored.entries).toEqual(entries)
    expect(restored.settings).toEqual(settings)
    expect(restored.version).toBe(1)
  })

  it('rejects malformed backups without returning partial data', () => {
    const malformed = JSON.stringify({
      version: 1,
      settings,
      entries: [{ id: 'broken', quantity: 0 }],
    })

    expect(() => parseBackup(malformed)).toThrow(
      'This file is not a valid Paceboard backup.',
    )
  })

  it('escapes commas, quotes, and newlines in CSV fields', () => {
    const detailed = createEntry({
      submittedAt: '2026-09-03T12:00:00.000Z',
      quantity: 1,
      type: 'targeted',
      company: 'Acme, Inc.',
      notes: 'Said "hello"\nFollow up Friday',
    })

    const csv = entriesToCsv([detailed])

    expect(csv).toContain('"Acme, Inc."')
    expect(csv).toContain('"Said ""hello""\nFollow up Friday"')
  })
})
