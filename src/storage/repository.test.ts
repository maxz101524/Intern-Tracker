import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApplication } from '../domain/entries'
import { createGmailCandidate, emptyGmailImportData } from '../domain/gmail'
import { buildBackup } from '../domain/backup'
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

  it('adds Gmail stores in v3 without changing v2 applications or settings', async () => {
    const existing = createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-09', effort: 'targeted',
    })
    await repository.destroy()
    const old = new Dexie(name)
    old.version(2).stores({
      entries: 'id, submittedDate, effort, source, company, updatedAt',
      settings: 'key',
    })
    await old.table('entries').put(existing)
    await old.table('settings').put({ key: 'app', weeklyTarget: 35, sources: ['Company site'], lastBackupAt: null })
    old.close()

    repository = new TrackerRepository(name)
    expect(await repository.listEntries()).toEqual([existing])
    expect(await repository.listGmailCandidates('pending')).toEqual([])
    expect(await repository.getGmailSyncState()).toEqual({ key: 'gmail', initialSyncCompleted: false })
  })

  it('upgrades v3 browser data to v4 without changing applications and adds safe defaults', async () => {
    const existing = createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-09', effort: 'targeted',
    })
    await repository.destroy()
    const old = new Dexie(name)
    old.version(3).stores({
      entries: 'id, submittedDate, effort, source, company, updatedAt, origin.messageId',
      settings: 'key',
      gmailCandidates: 'messageId, state, submittedDate, createdAt',
      processedGmailMessages: 'messageId, disposition, processedAt',
      gmailSync: 'key',
    })
    await old.table('entries').put(existing)
    await old.table('settings').put({ key: 'app', weeklyTarget: 35, sources: ['Company site'], lastBackupAt: null })
    old.close()

    repository = new TrackerRepository(name)
    expect(await repository.listEntries()).toEqual([existing])
    expect(await repository.getSettings()).toMatchObject({ weeklyTarget: 35, applicationDays: [1, 2, 3, 4, 5] })
    expect((await repository.getSettings()).resumeVariants).toContain('Applied AI')
  })

  it('persists Gmail candidates, processed messages, and sync state idempotently', async () => {
    const candidate = sampleCandidate()
    await repository.saveGmailCandidate(candidate)
    await repository.saveGmailCandidate({ ...candidate, title: 'Machine Learning Intern' })
    await repository.saveProcessedGmailMessage({
      messageId: candidate.messageId, disposition: 'candidate', processedAt: '2026-09-10T14:00:00.000Z',
    })
    await repository.saveGmailSyncState({
      key: 'gmail', accountEmail: 'max@example.com', historyId: '500',
      lastSuccessfulSyncAt: '2026-09-10T14:00:00.000Z', initialSyncCompleted: true,
    })

    expect(await repository.listGmailCandidates('pending')).toEqual([{ ...candidate, title: 'Machine Learning Intern' }])
    expect(await repository.hasProcessedGmailMessage(candidate.messageId)).toBe(true)
    expect(await repository.getGmailImportData()).toMatchObject({
      processedMessages: [{ messageId: candidate.messageId, disposition: 'candidate' }],
      syncState: { historyId: '500', initialSyncCompleted: true },
    })
  })

  it('reviews a Gmail candidate and creates its application atomically', async () => {
    const candidate = sampleCandidate()
    const application = createApplication({
      company: candidate.company, title: candidate.title, submittedDate: candidate.submittedDate,
      effort: 'quick', origin: { provider: 'gmail', messageId: candidate.messageId },
    })
    await repository.saveGmailCandidate(candidate)
    await repository.saveProcessedGmailMessage({
      messageId: candidate.messageId, disposition: 'candidate', processedAt: candidate.createdAt,
    })

    await repository.reviewGmailCandidate({
      candidate, disposition: 'imported', application, reviewedAt: '2026-09-10T15:00:00.000Z',
    })

    expect(await repository.listEntries()).toEqual([application])
    expect(await repository.listGmailCandidates('pending')).toEqual([])
    expect(await repository.getGmailCandidate(candidate.messageId)).toMatchObject({
      state: 'imported', reviewedAt: '2026-09-10T15:00:00.000Z',
    })
    expect((await repository.listProcessedGmailMessages())[0].disposition).toBe('imported')
  })

  it('restores Gmail backup data and clears it when restoring version 2', async () => {
    const candidate = sampleCandidate()
    const gmail = {
      candidates: [candidate],
      processedMessages: [{ messageId: candidate.messageId, disposition: 'candidate' as const, processedAt: candidate.createdAt }],
      syncState: { key: 'gmail' as const, historyId: '500', initialSyncCompleted: true },
    }
    const settings = { weeklyTarget: 35, sources: ['Company site'], lastBackupAt: null }
    await repository.restoreFromJson(JSON.stringify(buildBackup([], settings, gmail)))
    expect(await repository.getGmailImportData()).toEqual(gmail)

    await repository.restoreFromJson(JSON.stringify({ version: 2, entries: [], settings, exportedAt: candidate.createdAt }))
    expect(await repository.getGmailImportData()).toEqual(emptyGmailImportData())
  })

  it('resets Gmail history without deleting applications or settings', async () => {
    const application = createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-09', effort: 'quick',
    })
    await repository.saveEntry(application)
    await repository.saveGmailCandidate(sampleCandidate())
    await repository.saveSettings({ weeklyTarget: 40, sources: ['LinkedIn'], lastBackupAt: null })

    await repository.resetGmailImportHistory()

    expect(await repository.listEntries()).toEqual([application])
    expect(await repository.getSettings()).toMatchObject({ weeklyTarget: 40 })
    expect(await repository.getGmailImportData()).toEqual(emptyGmailImportData())
  })

  it('previews merge semantics by preserving current conflicts unless the backup is chosen', async () => {
    const current = createApplication({
      id: 'current', company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-09', effort: 'quick',
    })
    const incoming = createApplication({
      id: 'backup', company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-09', effort: 'targeted',
    })
    await repository.saveEntry(current)
    const settings = { weeklyTarget: 35, sources: ['Company site'], lastBackupAt: null }
    const raw = JSON.stringify(buildBackup([incoming], settings))

    await repository.restoreFromJson(raw, 'merge')
    expect(await repository.listEntries()).toEqual([current])
    await repository.restoreFromJson(raw, 'merge', { backup: 'backup' })
    expect(await repository.listEntries()).toEqual([incoming])
  })

  it('tracks changes and resets the displayed count when a backup is marked', async () => {
    await repository.saveSettings({ weeklyTarget: 35, sources: ['LinkedIn'], lastBackupAt: null })
    await repository.saveEntry(createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-09', effort: 'quick',
    }))
    const before = await repository.getSettings()
    expect(before.changeCount).toBe(2)
    const after = await repository.markBackup('2026-09-10T18:00:00.000Z')
    expect(after.lastBackupChangeCount).toBe(after.changeCount)
  })
})

function sampleCandidate() {
  return createGmailCandidate({
    messageId: 'gmail-1', threadId: 'thread-1', receivedAt: '2026-09-10T13:30:00.000Z',
    submittedDate: '2026-09-10', sender: 'jobs@acme.com', subject: 'Application received',
    company: 'Acme', title: 'Data Science Intern', confidence: 'high',
    matchedRule: 'generic-confirmation', createdAt: '2026-09-10T14:00:00.000Z',
  })
}
