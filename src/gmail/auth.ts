const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client'

export interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}

export interface GoogleTokenClient {
  requestAccessToken(config?: { prompt?: string }): void
}

export interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
    error_callback?: () => void
  }): GoogleTokenClient
  revoke(token: string, done: () => void): void
}

export type GmailAuthStatus = 'unconfigured' | 'disconnected' | 'connecting' | 'connected' | 'expired' | 'error'

export interface GmailAuthState {
  status: GmailAuthStatus
  expiresAt?: number
  error?: string
}

export interface GmailAuthClient {
  requestToken(): Promise<string>
  getValidToken(): string | null
  getState(): GmailAuthState
  invalidate(): void
  disconnect(): Promise<void>
  subscribe(listener: (state: GmailAuthState) => void): () => void
}

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } }
  }
}

let googleScriptPromise: Promise<GoogleOAuth2> | null = null

export function createGmailAuthClient(clientId: string, providedOAuth?: GoogleOAuth2): GmailAuthClient {
  let accessToken: string | null = null
  let expiresAt = 0
  let oauth = providedOAuth
  let state: GmailAuthState = clientId ? { status: 'disconnected' } : { status: 'unconfigured' }
  let activeRequest: Promise<string> | null = null
  const listeners = new Set<(next: GmailAuthState) => void>()

  function setState(next: GmailAuthState) {
    state = next
    for (const listener of listeners) listener(state)
  }

  function requestToken(): Promise<string> {
    if (!clientId) {
      const error = new Error('Gmail import is not configured.')
      setState({ status: 'unconfigured', error: error.message })
      return Promise.reject(error)
    }
    if (activeRequest) return activeRequest
    setState({ status: 'connecting' })

    const begin = (resolved: GoogleOAuth2) => {
      oauth = resolved
      return new Promise<string>((resolve, reject) => {
        let settled = false
        let timeout = 0
        const finishError = () => {
          if (settled) return
          settled = true
          window.clearTimeout(timeout)
          const error = new Error('Google authorization was not completed.')
          setState({ status: 'error', error: error.message })
          reject(error)
        }
        const client = resolved.initTokenClient({
          client_id: clientId,
          scope: GMAIL_SCOPE,
          callback: (response) => {
            if (settled) return
            if (response.error || !response.access_token) {
              finishError()
              return
            }
            settled = true
            window.clearTimeout(timeout)
            accessToken = response.access_token
            expiresAt = Date.now() + Math.max(0, response.expires_in ?? 3600) * 1000
            setState({ status: 'connected', expiresAt })
            resolve(accessToken)
          },
          error_callback: finishError,
        })
        timeout = window.setTimeout(finishError, 120_000)
        client.requestAccessToken({ prompt: '' })
      })
    }
    const tokenRequest = oauth ? begin(oauth) : loadGoogleIdentityServices().then(begin)
    activeRequest = tokenRequest.catch((caught: unknown) => {
      if (caught instanceof Error && caught.message === 'Google authorization was not completed.') throw caught
      const error = new Error('Google authorization could not start.')
      setState({ status: 'error', error: error.message })
      throw error
    }).finally(() => {
      activeRequest = null
    })
    return activeRequest
  }

  function getValidToken(): string | null {
    if (!accessToken) return null
    if (Date.now() >= expiresAt) {
      accessToken = null
      setState({ status: 'expired' })
      return null
    }
    return accessToken
  }

  async function disconnect(): Promise<void> {
    const token = accessToken
    accessToken = null
    expiresAt = 0
    if (token && oauth) {
      await new Promise<void>((resolve) => oauth?.revoke(token, resolve))
    }
    setState({ status: clientId ? 'disconnected' : 'unconfigured' })
  }

  return {
    requestToken,
    getValidToken,
    getState: () => state,
    invalidate() {
      accessToken = null
      expiresAt = 0
      setState({ status: 'expired' })
    },
    disconnect,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function loadGoogleIdentityServices(): Promise<GoogleOAuth2> {
  const existing = window.google?.accounts?.oauth2
  if (existing) return Promise.resolve(existing)
  if (googleScriptPromise) return googleScriptPromise

  googleScriptPromise = new Promise<GoogleOAuth2>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`)
    const script = existingScript ?? document.createElement('script')
    script.onload = () => {
      const loaded = window.google?.accounts?.oauth2
      if (loaded) resolve(loaded)
      else reject(new Error('Google authorization could not start.'))
    }
    script.onerror = () => reject(new Error('Google authorization could not start.'))
    if (!existingScript) {
      script.src = GOOGLE_SCRIPT
      script.async = true
      script.defer = true
      document.head.append(script)
    }
  }).catch((error) => {
    googleScriptPromise = null
    throw error
  })
  return googleScriptPromise
}
