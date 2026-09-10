import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGmailAuthClient, type GoogleOAuth2 } from './auth'

describe('Gmail browser authorization', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps a token in memory until its expiry and notifies subscribers', async () => {
    let tokenCallback: ((response: { access_token?: string; expires_in?: number; error?: string }) => void) | undefined
    const oauth = fakeOAuth((config) => {
      tokenCallback = config.callback
      return { requestAccessToken: () => tokenCallback?.({ access_token: 'token', expires_in: 3600 }) }
    })
    const auth = createGmailAuthClient('client-id', oauth)
    const statuses: string[] = []
    auth.subscribe((state) => statuses.push(state.status))

    await expect(auth.requestToken()).resolves.toBe('token')
    expect(auth.getValidToken()).toBe('token')
    expect(statuses).toContain('connected')

    vi.advanceTimersByTime(3_600_001)
    expect(auth.getValidToken()).toBeNull()
    expect(auth.getState().status).toBe('expired')
  })

  it('revokes the current token and returns to disconnected', async () => {
    const revoke = vi.fn((_token: string, done: () => void) => done())
    const oauth = fakeOAuth((config) => ({
      requestAccessToken: () => config.callback({ access_token: 'token', expires_in: 3600 }),
    }), revoke)
    const auth = createGmailAuthClient('client-id', oauth)
    await auth.requestToken()

    await auth.disconnect()

    expect(revoke).toHaveBeenCalledWith('token', expect.any(Function))
    expect(auth.getValidToken()).toBeNull()
    expect(auth.getState().status).toBe('disconnected')
  })

  it('reports missing configuration and OAuth errors safely', async () => {
    const missing = createGmailAuthClient('', fakeOAuth(() => ({ requestAccessToken: vi.fn() })))
    await expect(missing.requestToken()).rejects.toThrow('Gmail import is not configured.')
    expect(missing.getState().status).toBe('unconfigured')

    const failed = createGmailAuthClient('client-id', fakeOAuth((config) => ({
      requestAccessToken: () => config.callback({ error: 'access_denied' }),
    })))
    await expect(failed.requestToken()).rejects.toThrow('Google authorization was not completed.')
    expect(failed.getState()).toMatchObject({ status: 'error', error: 'Google authorization was not completed.' })
  })

  it('shares one promise when authorization is already in progress', async () => {
    let finish: (() => void) | undefined
    const auth = createGmailAuthClient('client-id', fakeOAuth((config) => ({
      requestAccessToken: () => { finish = () => config.callback({ access_token: 'token', expires_in: 3600 }) },
    })))

    const first = auth.requestToken()
    const second = auth.requestToken()
    finish?.()

    await expect(first).resolves.toBe('token')
    await expect(second).resolves.toBe('token')
  })
})

function fakeOAuth(
  initTokenClient: GoogleOAuth2['initTokenClient'],
  revoke: GoogleOAuth2['revoke'] = vi.fn((_token, done) => done()),
): GoogleOAuth2 {
  return { initTokenClient, revoke }
}
