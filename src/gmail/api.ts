import type { GmailApiMessage } from './types'

const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const INITIAL_QUERY = '{"your application" "application update" "application confirmation" "thank you for applying" "received your application" "successfully applied" assessment hackerrank codesignal codility interview "phone screen" unfortunately "not moving forward" "not selected" "regret to inform" "job offer"}'

export type GmailApiErrorCode =
  | 'authorization'
  | 'history-expired'
  | 'message-unavailable'
  | 'rate-limited'
  | 'unavailable'
  | 'request-failed'

export type GmailApiOperation = 'profile' | 'search' | 'history' | 'message'

export class GmailApiError extends Error {
  constructor(
    public readonly code: GmailApiErrorCode,
    public readonly status: number,
    public readonly operation?: GmailApiOperation,
  ) {
    super(messageFor(code, status, operation))
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
  async function request<T>(url: string, operation: GmailApiOperation): Promise<T> {
    const token = getAccessToken()
    if (!token) throw new GmailApiError('authorization', 401, operation)
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw classifyError(response.status, operation)
    return response.json() as Promise<T>
  }

  return {
    async getProfile() {
      return request<GmailProfile>(`${GMAIL_API}/profile`, 'profile')
    },

    async listInitialMessageIds(afterEpochSeconds) {
      const ids = new Set<string>()
      let pageToken: string | undefined
      do {
        const url = new URL(`${GMAIL_API}/messages`)
        url.searchParams.set('maxResults', '100')
        url.searchParams.set('q', `after:${Math.floor(afterEpochSeconds)} ${INITIAL_QUERY}`)
        if (pageToken) url.searchParams.set('pageToken', pageToken)
        const page = await request<{ messages?: Array<{ id?: string }>; nextPageToken?: string }>(url.toString(), 'search')
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
        }>(url.toString(), 'history')
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
      return request<GmailApiMessage>(url.toString(), 'message')
    },
  }
}

function classifyError(status: number, operation: GmailApiOperation): GmailApiError {
  if (status === 401 || status === 403) return new GmailApiError('authorization', status, operation)
  if (status === 404 && operation === 'history') return new GmailApiError('history-expired', status, operation)
  if (status === 404 && operation === 'message') return new GmailApiError('message-unavailable', status, operation)
  if (status === 429) return new GmailApiError('rate-limited', status, operation)
  if (status >= 500) return new GmailApiError('unavailable', status, operation)
  return new GmailApiError('request-failed', status, operation)
}

function messageFor(code: GmailApiErrorCode, status: number, operation?: GmailApiOperation): string {
  if (code === 'authorization') return 'Reconnect Gmail to continue syncing.'
  if (code === 'history-expired') return 'Gmail history expired; a recovery scan is required.'
  if (code === 'message-unavailable') return 'A Gmail message became unavailable before it could be synced.'
  if (code === 'rate-limited') return 'Gmail is temporarily limiting requests. Try again shortly.'
  if (code === 'unavailable') return 'Gmail is temporarily unavailable.'
  return operation
    ? `Gmail could not complete the ${operation} request (HTTP ${status}).`
    : `Gmail could not complete the request (HTTP ${status}).`
}
