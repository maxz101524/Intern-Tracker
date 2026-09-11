import { describe, expect, it } from 'vitest'
import { buildBackup, entriesToCsv, parseBackup } from './backup'
import { createApplication } from './entries'
import { appendStatus } from './status'
import { emptyGmailImportData } from './gmail'
import type { AppSettings, GmailCandidate, GmailImportData, ProcessedGmailMessage } from './types'

const settings: AppSettings = {
  weeklyTarget: 35,
  sources: ['LinkedIn', 'Company site'],
  lastBackupAt: null,
}

describe('backup and export v4', () => {
  it('round-trips every application and its status history', () => {
    const application = appendStatus(createApplication({
      company: 'Acme',
      title: 'ML Intern',
      submittedDate: '2026-09-03',
      effort: 'targeted',
      nextAction: 'Prepare for interview',
      nextActionDueDate: '2026-09-22',
      jobDescriptionExcerpt: 'Build reliable applied AI systems.',
    }), 'interview', '2026-09-20')

    const gmail = emptyGmailImportData()
    const backup = buildBackup([application], settings, gmail, '2026-09-21T14:00:00.000Z')
    const restored = parseBackup(JSON.stringify(backup))

    expect(restored.entries).toEqual([application])
    expect(restored.settings).toMatchObject(settings)
    expect(restored.settings.resumeVariants).toContain('Applied AI')
    expect(restored.gmail).toEqual(gmail)
    expect(restored.version).toBe(4)
  })

  it('round-trips review candidates, processed IDs, and non-secret sync state', () => {
    const candidate: GmailCandidate = {
      messageId: 'gmail-1', threadId: 'thread-1', receivedAt: '2026-09-10T13:30:00.000Z',
      submittedDate: '2026-09-10', sender: 'jobs@acme.com', subject: 'Application received',
      company: 'Acme', title: 'Data Science Intern', confidence: 'high', matchedRule: 'generic-confirmation',
      state: 'pending', createdAt: '2026-09-10T14:00:00.000Z',
    }
    const processed: ProcessedGmailMessage = {
      messageId: 'gmail-1', disposition: 'candidate', processedAt: '2026-09-10T14:00:00.000Z',
    }
    const gmail: GmailImportData = {
      candidates: [candidate], processedMessages: [processed],
      syncState: {
        key: 'gmail', accountEmail: 'max@example.com', historyId: '500',
        lastSuccessfulSyncAt: '2026-09-10T14:00:00.000Z', initialSyncCompleted: true,
      },
    }

    expect(parseBackup(JSON.stringify(buildBackup([], settings, gmail, '2026-09-10T15:00:00.000Z'))).gmail)
      .toEqual(gmail)
  })

  it('normalizes version-2 backups with empty Gmail import data', () => {
    const v2 = { version: 2, exportedAt: '2026-09-10T14:00:00.000Z', entries: [], settings }
    expect(parseBackup(JSON.stringify(v2))).toMatchObject({ version: 4, gmail: emptyGmailImportData() })
  })

  it('rejects version-1 aggregate backups with a specific message', () => {
    expect(() => parseBackup(JSON.stringify({ version: 1, entries: [], settings }))).toThrow(
      'Paceboard v1 backups cannot be restored into the singular-role tracker.',
    )
  })

  it('rejects malformed v2 or v3 backups without returning partial data', () => {
    const malformed = JSON.stringify({
      version: 2,
      settings,
      entries: [{ id: 'broken', company: '', title: 'Intern' }],
    })

    expect(() => parseBackup(malformed)).toThrow('This file is not a valid Paceboard backup.')

    const invalidGmail = buildBackup([], settings, emptyGmailImportData()) as unknown as Record<string, unknown>
    invalidGmail.gmail = { candidates: [{ messageId: '' }], processedMessages: [], syncState: { key: 'gmail' } }
    expect(() => parseBackup(JSON.stringify(invalidGmail))).toThrow('This file is not a valid Paceboard backup.')
  })

  it('exports one escaped row per application with current status and history', () => {
    const application = appendStatus(createApplication({
      company: 'Acme, Inc.',
      title: 'ML Intern',
      submittedDate: '2026-09-03',
      effort: 'targeted',
      notes: 'Said "hello"\nFollow up Friday',
      origin: { provider: 'gmail', messageId: 'gmail-42' },
    }), 'online_assessment', '2026-09-10')

    const csv = entriesToCsv([application], '2026-09-24')

    expect(csv.split('\n')[0]).toContain('currentStatus,statusHistory')
    expect(csv.split('\n')[0]).toContain('originProvider,originMessageId')
    expect(csv).toContain('Online assessment')
    expect(csv).toContain('2026-09-03:Applied | 2026-09-10:Online assessment')
    expect(csv).toContain('"Acme, Inc."')
    expect(csv).toContain('gmail,gmail-42')
    expect(csv).toContain('"Said ""hello""\nFollow up Friday"')
  })
})
