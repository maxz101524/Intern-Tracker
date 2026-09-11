import type { GmailApiMessage } from './types'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const INITIAL_QUERY = '{"thank you for applying" "received your application" "application received" "application confirmation" "successfully applied" assessment interview unfortunately "not moving forward"}'

export type GmailApiErrorCode = 'authorization' | 'history-expired' | 'rate-limited' | 'unavailable' | 'request-failed'

export class GmailApiError extends Error {
  constructor(public readonly code: GmailApiErrorCode, public readonly status: number) {
    super(messageFor(code))
    this.name = 'GmailApiError'
  }
}

export interface GmailProfile {
  emailAddress: string
  historyId: string
  messagesTotal?: number
}

export interface GmailHistoryResult {
  messageIds: string[]
  historyId: string
}

export interface GmailApiClient {
  getProfile(): Promise<GmailProfile>
  listInitialMessageIds(afterEpochSeconds: number): Promise<string[]>
  listHistoryMessageIds(startHistoryId: string): Promise<GmailHistoryResult>
  getMessage(id: string): Promise<GmailApiMessage>
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export function createGmailApiClient(getAccessToken: () => string | null, fetchImpl: Fetch = fetch): GmailApiClient {
  async function request<T>(url: string, history = false): Promise<T> {
    const token = getAccessToken()
    if (!token) throw new GmailApiError('authorization', 401)
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw classifyError(response.status, history)
    return response.json() as Promise<T>
  }

  return {
    async getProfile() {
      return request<GmailProfile>(`${GMAIL_API}/profile`)
    },

    async listInitialMessageIds(afterEpochSeconds) {
      const ids = new Set<string>()
      let pageToken: string | undefined
      do {
        const url = new URL(`${GMAIL_API}/messages`)
        url.searchParams.set('maxResults', '100')
        url.searchParams.set('q', `after:${Math.floor(afterEpochSeconds)} ${INITIAL_QUERY}`)
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        const page = await request<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(url.toString())
        for (const message of page.messages ?? []) if (message.id) ids.add(message.id)
        pageToken = page.nextPageToken
      } while (pageToken)
      return [...ids]
    },

    async listHistoryMessageIds(startHistoryId) {
      const ids = new Set<string>()
      let pageToken: string | undefined
      let newestHistoryId = startHistoryId
      do {
        const url = new URL(`${GMAIL_API}/history`)
        url.searchParams.set('startHistoryId', startHistoryId)
        url.searchParams.set('historyTypes', 'messageAdded')
        url.searchParams.set('maxResults', '100')
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        const page = await request<{
          history?: Array<{ messagesAdded?: Array<{ message?: { id?: string } }> }>
          historyId?: string
          nextPageToken?: string
        }>(url.toString(), true)
        for (const history of page.history ?? []) {
          for (const added of history.messagesAdded ?? []) if (added.message?.id) ids.add(added.message.id)
        }
        if (page.historyId) newestHistoryId = page.historyId
        pageToken = page.nextPageToken
      } while (pageToken)
      return { messageIds: [...ids], historyId: newestHistoryId }
    },

    async getMessage(id) {
      const url = new URL(`${GMAIL_API}/messages/${encodeURIComponent(id)}`)
      url.searchParams.set('format', 'full')
      return request<GmailApiMessage>(url.toString())
    },
  }
}

function classifyError(status: number, history: boolean): GmailApiError {
  if (status === 401 || status === 403) return new GmailApiError('authorization', status)
  if (status === 404 && history) return new GmailApiError('history-expired', status)
  if (status === 429) return new GmailApiError('rate-limited', status)
  if (status >= 500) return new GmailApiError('unavailable', status)
  return new GmailApiError('request-failed', status)
}

function messageFor(code: GmailApiErrorCode): string {
  if (code === 'authorization') return 'Reconnect Gmail to continue syncing.'
  if (code === 'history-expired') return 'Gmail history expired; a recovery scan is required.'
  if (code === 'rate-limited') return 'Gmail is temporarily limiting requests. Try again shortly.'
  if (code === 'unavailable') return 'Gmail is temporarily unavailable.'
  return 'Gmail could not complete the request.'
}
