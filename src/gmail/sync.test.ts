import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrackerRepository } from '../storage/repository'
import { TrackerRepository as Repository } from '../storage/repository'
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
      lastSuccessfulSyncAt: '2026-09-10T14:00:00.000Z', initialSyncCompleted: true,
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

  it('fails closed when a different Gmail account is selected', async () => {
    await repository.saveGmailSyncState({
      key: 'gmail', accountEmail: 'first@example.com', historyId: '500', initialSyncCompleted: true,
    })
    const api = fakeApi({ getProfile: vi.fn().mockResolvedValue({ emailAddress: 'other@example.com', historyId: '520' }) })

    await expect(syncGmail({ api, repository })).rejects.toThrow('Reconnect the Gmail account previously used by Paceboard.')
    expect(api.listHistoryMessageIds).not.toHaveBeenCalled()
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
