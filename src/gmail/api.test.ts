import { describe, expect, it, vi } from 'vitest'
import { createGmailApiClient, GmailApiError } from './api'

describe('Gmail REST client', () => {
  it('reads the profile and retrieves a full message with a bearer token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ emailAddress: 'max@example.com', historyId: '500', messagesTotal: 20 }))
      .mockResolvedValueOnce(json({ id: 'm1', threadId: 't1', internalDate: '1789047000000', payload: {} }))
    const api = createGmailApiClient(() => 'token', fetchMock)

    await expect(api.getProfile()).resolves.toMatchObject({ emailAddress: 'max@example.com', historyId: '500' })
    await expect(api.getMessage('m1')).resolves.toMatchObject({ id: 'm1', threadId: 't1' })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/gmail/v1/users/me/messages/m1?format=full'),
      { headers: { Authorization: 'Bearer token' } },
    )
  })

  it('lists a bounded initial query through every page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ messages: [{ id: 'm1' }], nextPageToken: 'next' }))
      .mockResolvedValueOnce(json({ messages: [{ id: 'm2' }, { id: 'm1' }] }))
    const api = createGmailApiClient(() => 'token', fetchMock)

    await expect(api.listInitialMessageIds(1786456800)).resolves.toEqual(['m1', 'm2'])
    const firstUrl = new URL(fetchMock.mock.calls[0][0])
    expect(firstUrl.searchParams.get('q')).toContain('after:1786456800')
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pageToken')).toBe('next')
  })

  it('lists only added history messages and returns the newest history ID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({
        history: [{ messagesAdded: [{ message: { id: 'm1' } }] }], nextPageToken: 'next', historyId: '510',
      }))
      .mockResolvedValueOnce(json({
        history: [{ messagesAdded: [{ message: { id: 'm2' } }, { message: { id: 'm1' } }] }], historyId: '520',
      }))
    const api = createGmailApiClient(() => 'token', fetchMock)

    await expect(api.listHistoryMessageIds('500')).resolves.toEqual({ messageIds: ['m1', 'm2'], historyId: '520' })
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('startHistoryId')).toBe('500')
  })

  it.each([
    [401, 'authorization'],
    [404, 'history-expired'],
    [429, 'rate-limited'],
    [503, 'unavailable'],
  ] as const)('classifies HTTP %s without leaking response content', async (status, code) => {
    const api = createGmailApiClient(() => 'token', vi.fn().mockResolvedValue(new Response('private mailbox content', { status })))
    const error = await api.listHistoryMessageIds('500').catch((caught) => caught)
    expect(error).toBeInstanceOf(GmailApiError)
    expect(error).toMatchObject({ code, status })
    expect(String(error)).not.toContain('private mailbox content')
  })

  it('requires a live access token before making a request', async () => {
    const fetchMock = vi.fn()
    const api = createGmailApiClient(() => null, fetchMock)
    await expect(api.getProfile()).rejects.toMatchObject({ code: 'authorization', status: 401 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
