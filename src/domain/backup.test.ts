import { describe, expect, it } from 'vitest'
import { buildBackup, entriesToCsv, parseBackup } from './backup'
import { createApplication } from './entries'
import { appendStatus } from './status'
import type { AppSettings } from './types'

const settings: AppSettings = {
  weeklyTarget: 35,
  sources: ['LinkedIn', 'Company site'],
  lastBackupAt: null,
}

describe('backup and export v2', () => {
  it('round-trips every application and its status history', () => {
    const application = appendStatus(createApplication({
      company: 'Acme',
      title: 'ML Intern',
      submittedDate: '2026-09-03',
      effort: 'targeted',
    }), 'interview', '2026-09-20')

    const backup = buildBackup([application], settings, '2026-09-21T14:00:00.000Z')
    const restored = parseBackup(JSON.stringify(backup))

    expect(restored.entries).toEqual([application])
    expect(restored.settings).toEqual(settings)
    expect(restored.version).toBe(2)
  })

  it('rejects version-1 aggregate backups with a specific message', () => {
    expect(() => parseBackup(JSON.stringify({ version: 1, entries: [], settings }))).toThrow(
      'Paceboard v1 backups cannot be restored into the singular-role tracker.',
    )
  })

  it('rejects malformed v2 backups without returning partial data', () => {
    const malformed = JSON.stringify({
      version: 2,
      settings,
      entries: [{ id: 'broken', company: '', title: 'Intern' }],
    })

    expect(() => parseBackup(malformed)).toThrow('This file is not a valid Paceboard backup.')
  })

  it('exports one escaped row per application with current status and history', () => {
    const application = appendStatus(createApplication({
      company: 'Acme, Inc.',
      title: 'ML Intern',
      submittedDate: '2026-09-03',
      effort: 'targeted',
      notes: 'Said "hello"\nFollow up Friday',
    }), 'online_assessment', '2026-09-10')

    const csv = entriesToCsv([application], '2026-09-24')

    expect(csv.split('\n')[0]).toContain('currentStatus,statusHistory')
    expect(csv).toContain('Online assessment')
    expect(csv).toContain('2026-09-03:Applied | 2026-09-10:Online assessment')
    expect(csv).toContain('"Acme, Inc."')
    expect(csv).toContain('"Said ""hello""\nFollow up Friday"')
  })
})
