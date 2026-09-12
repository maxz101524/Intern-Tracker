import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerRepository } from '../storage/repository'
import { TrackerRepository as Repository } from '../storage/repository'
import { createApplication } from '../domain/entries'
import { createGmailCandidate } from '../domain/gmail'
import { GmailApiError, type GmailApiClient } from './api'
import { syncGmail } from './sync'
import type { GmailApiMessage } from './types'

describe('Gmail synchronization', () => {
  let repository: TrackerRepository

  beforeEach(() => {
    repository = new Repository(`paceboard-gmail-sync-${crypto.randomUUID()}`)
  })

  afterEach(async () => repository.destroy())

  it('performs a 30-day initial scan and atomically stores candidates and its checkpoint', async () => {
    const api = fakeApi({
      getProfile: vi.fn().mockResolvedValue({ emailAddress: 'max@example.com', historyId: '500' }),
      listInitialMessageIds: vi.fn().mockResolvedValue(['m1', 'm2']),
      getMessage: vi.fn()
        .mockResolvedValueOnce(message('m1', 'Thank you for applying', 'Thank you for applying to Data Science Intern at Acme.'))
        .mockResolvedValueOnce(message('m2', 'New jobs near you', 'Your weekly job alert')),
    })

    const result = await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00.000Z') })

    expect(api.listInitialMessageIds).toHaveBeenCalledWith(1786456800)
    expect(result).toEqual({ newCandidates: 1, inspectedMessages: 2, mode: 'initial', syncedAt: '2026-09-10T14:00:00.000Z' })
    expect(await repository.listGmailCandidates('pending')).toEqual([
      expect.objectContaining({ messageId: 'm1', company: 'Acme', title: 'Data Science Intern' }),
    ])
    expect(await repository.listProcessedGmailMessages()).toEqual([
      expect.objectContaining({ messageId: 'm1', disposition: 'candidate' }),
      expect.objectContaining({ messageId: 'm2', disposition: 'ignored' }),
    ])
    expect(await repository.getGmailSyncState()).toEqual({
      key: 'gmail', accountEmail: 'max@example.com', historyId: '500',
      lastSuccessfulSyncAt: '2026-09-10T14:00:00.000Z', initialSyncCompleted: true, detectorVersion: 2,
    })
  })

  it('uses Gmail history after the initial checkpoint and skips exact message IDs', async () => {
    await repository.saveGmailSyncState({
      key: 'gmail', accountEmail: 'max@example.com', historyId: '500',
      lastSuccessfulSyncAt: '2026-09-09T12:00:00.000Z', initialSyncCompleted: true,
    })
    await repository.saveProcessedGmailMessage({
      messageId: 'm1', disposition: 'ignored', processedAt: '2026-09-09T12:00:00.000Z',
    })
    const api = fakeApi({
      getProfile: vi.fn().mockResolvedValue({ emailAddress: 'max@example.com', historyId: '520' }),
      listHistoryMessageIds: vi.fn().mockResolvedValue({ messageIds: ['m1', 'm2'], historyId: '520' }),
      getMessage: vi.fn().mockResolvedValue(message('m2', 'Application received', 'We received your application for the ML Intern position at Acme.')),
    })

    const result = await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00.000Z') })

    expect(result.mode).toBe('incremental')
    expect(api.listHistoryMessageIds).toHaveBeenCalledWith('500')
    expect(api.listInitialMessageIds).not.toHaveBeenCalled()
    expect(api.getMessage).toHaveBeenCalledTimes(1)
    expect(api.getMessage).toHaveBeenCalledWith('m2')
    expect((await repository.getGmailSyncState()).historyId).toBe('520')
  })

  it('recovers an expired history cursor with a two-day overlap', async () => {
    await repository.saveGmailSyncState({
      key: 'gmail', accountEmail: 'max@example.com', historyId: '500',
      lastSuccessfulSyncAt: '2026-09-09T12:00:00.000Z', initialSyncCompleted: true,
    })
    const api = fakeApi({
      getProfile: vi.fn().mockResolvedValue({ emailAddress: 'max@example.com', historyId: '700' }),
      listHistoryMessageIds: vi.fn().mockRejectedValue(new GmailApiError('history-expired', 404)),
      listInitialMessageIds: vi.fn().mockResolvedValue([]),
    })

    const result = await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00.000Z') })

    expect(result.mode).toBe('recovery')
    expect(api.listInitialMessageIds).toHaveBeenCalledWith(1788782400)
    expect((await repository.getGmailSyncState()).historyId).toBe('700')
  })

  it('does not advance the checkpoint when Gmail fails', async () => {
    const previous = {
      key: 'gmail' as const, accountEmail: 'max@example.com', historyId: '500',
      lastSuccessfulSyncAt: '2026-09-09T12:00:00.000Z', initialSyncCompleted: true,
    }
    await repository.saveGmailSyncState(previous)
    const api = fakeApi({
      getProfile: vi.fn().mockResolvedValue({ emailAddress: 'max@example.com', historyId: '520' }),
      listHistoryMessageIds: vi.fn().mockRejectedValue(new GmailApiError('rate-limited', 429)),
    })

    await expect(syncGmail({ api, repository })).rejects.toMatchObject({ code: 'rate-limited' })
    expect(await repository.getGmailSyncState()).toEqual(previous)
  })

  it('retries individual messages that previously failed local parsing', async () => {
    await repository.saveGmailSyncState({
      key: 'gmail', accountEmail: 'max@example.com', historyId: '500',
      lastSuccessfulSyncAt: '2026-09-09T12:00:00.000Z', initialSyncCompleted: true,
    })
    await repository.saveProcessedGmailMessage({
      messageId: 'm1', disposition: 'error', processedAt: '2026-09-09T12:00:00.000Z',
    })
    const api = fakeApi({
      listHistoryMessageIds: vi.fn().mockResolvedValue({ messageIds: [], historyId: '520' }),
      getMessage: vi.fn().mockResolvedValue(message('m1', 'Application received', 'We received your application for the ML Intern position at Acme.')),
    })

    const result = await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00.000Z') })

    expect(result).toMatchObject({ newCandidates: 1, inspectedMessages: 1 })
    expect(api.getMessage).toHaveBeenCalledWith('m1')
    expect((await repository.listProcessedGmailMessages())[0].disposition).toBe('candidate')
  })

  it('fails closed when a different Gmail account is selected', async () => {
    await repository.saveGmailSyncState({
      key: 'gmail', accountEmail: 'first@example.com', historyId: '500', initialSyncCompleted: true,
    })
    const api = fakeApi({ getProfile: vi.fn().mockResolvedValue({ emailAddress: 'other@example.com', historyId: '520' }) })

    await expect(syncGmail({ api, repository })).rejects.toThrow('Reconnect the Gmail account previously used by Paceboard.')
    expect(api.listHistoryMessageIds).not.toHaveBeenCalled()
  })

  it('creates a matched status suggestion for an assessment invitation', async () => {
    const application = createApplication({
      company: 'Acme', title: 'Data Science Intern', submittedDate: '2026-09-01', effort: 'quick',
    })
    await repository.saveEntry(application)
    const api = fakeApi({
      listInitialMessageIds: vi.fn().mockResolvedValue(['assessment-1']),
      getMessage: vi.fn().mockResolvedValue(message(
        'assessment-1',
        'Assessment invitation for Data Science Intern at Acme',
        'Please complete the assessment by Friday.',
      )),
    })

    await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00.000Z') })

    expect(await repository.listGmailCandidates('pending')).toEqual([
      expect.objectContaining({
        kind: 'status', suggestedStatus: 'online_assessment', eventDate: '2026-09-10',
        matchedEntryIds: [application.id],
      }),
    ])
  })

  it('skips a confirmation that confidently duplicates a manually added application', async () => {
    await repository.saveEntry(createApplication({
      company: "DICK'S Sporting Goods, Inc.", title: 'Data Analytics & Engineering - Summer 2027 Internship', submittedDate: '2026-09-10', effort: 'quick',
    }))
    const api = fakeApi({
      listInitialMessageIds: vi.fn().mockResolvedValue(['duplicate-manual']),
      getMessage: vi.fn().mockResolvedValue(message(
        'duplicate-manual', 'Application received',
        "We received your application for the Data Analytics & Engineering Internship at Dicks Sporting Goods.",
      )),
    })

    const result = await syncGmail({ api, repository, now: new Date('2026-09-08T14:00:00.000Z') })

    expect(result.newCandidates).toBe(0)
    expect(await repository.listGmailCandidates('pending')).toEqual([])
    expect(await repository.listProcessedGmailMessages()).toEqual([
      expect.objectContaining({ messageId: 'duplicate-manual', disposition: 'ignored' }),
    ])
  })

  it('reprocesses old pending matches once after detector rules improve', async () => {
    await repository.saveGmailSyncState({
      key: 'gmail', accountEmail: 'max@example.com', historyId: '500',
      lastSuccessfulSyncAt: '2026-09-09T12:00:00.000Z', initialSyncCompleted: true,
    })
    const oldCandidate = createGmailCandidate({
      messageId: 'old-false-positive', threadId: 'thread-old', receivedAt: '2026-09-09T13:30:00.000Z', submittedDate: '2026-09-09',
      sender: 'Oracle Recruiting <sender@workflow.email.us-phoenix-1.ocs.oraclecloud.com>',
      subject: 'Continue to apply for the job AI Intern', company: 'Oraclecloud', title: 'AI Intern',
      confidence: 'medium', matchedRule: 'oracle-confirmation',
    })
    await repository.saveGmailCandidate(oldCandidate)
    await repository.saveProcessedGmailMessage({
      messageId: oldCandidate.messageId, disposition: 'candidate', processedAt: '2026-09-09T14:00:00.000Z',
    })
    const api = fakeApi({
      listHistoryMessageIds: vi.fn().mockResolvedValue({ messageIds: [], historyId: '520' }),
      getMessage: vi.fn().mockResolvedValue(message(
        oldCandidate.messageId, oldCandidate.subject, 'Thank you for your interest. Continue your application to be considered.',
      )),
    })

    await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00.000Z') })

    expect(api.getMessage).toHaveBeenCalledWith(oldCandidate.messageId)
    expect(await repository.listGmailCandidates('pending')).toEqual([])
    expect(await repository.getGmailSyncState()).toMatchObject({ detectorVersion: 2, historyId: '520' })
  })

  it('queues only one review item when Gmail sends duplicate confirmations', async () => {
    const api = fakeApi({
      listInitialMessageIds: vi.fn().mockResolvedValue(['confirmation-1', 'confirmation-2']),
      getMessage: vi.fn()
        .mockResolvedValueOnce(message('confirmation-1', 'Application received', 'We received your application for the ML Intern position at Acme.'))
        .mockResolvedValueOnce(message('confirmation-2', 'Application confirmation', 'Thank you for applying to the ML Intern role at Acme.')),
    })

    const result = await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00.000Z') })

    expect(result.newCandidates).toBe(1)
    expect(await repository.listGmailCandidates('pending')).toHaveLength(1)
    expect((await repository.listProcessedGmailMessages()).map((item) => item.disposition).sort()).toEqual(['candidate', 'ignored'])
  })
})

function fakeApi(overrides: Partial<GmailApiClient>): GmailApiClient {
  return {
    getProfile: vi.fn().mockResolvedValue({ emailAddress: 'max@example.com', historyId: '500' }),
    listInitialMessageIds: vi.fn().mockResolvedValue([]),
    listHistoryMessageIds: vi.fn().mockResolvedValue({ messageIds: [], historyId: '500' }),
    getMessage: vi.fn(),
    ...overrides,
  }
}

function message(id: string, subject: string, text: string): GmailApiMessage {
  return {
    id, threadId: `thread-${id}`, internalDate: '1789047000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Acme Recruiting <jobs@acme.com>' },
        { name: 'Subject', value: subject },
      ],
      body: { data: encode(text) },
    },
  }
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
