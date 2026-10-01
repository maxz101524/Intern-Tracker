import { validateMuseBatch, type MuseBatch, type MuseLedger } from '../../shared/museContract'
import type { MuseIncomingBatch } from '../domain/muse'

export type MuseRelayErrorCode = 'missing-key' | 'unauthorized' | 'unconfigured' | 'network' | 'server' | 'invalid'

export class MuseRelayError extends Error {
  constructor(readonly code: MuseRelayErrorCode, message: string) {
    super(message)
    this.name = 'MuseRelayError'
  }
}

export interface MusePullResult {
  batches: MuseIncomingBatch[]
  cursor: string | null
  oldestId: string | null
}

export interface MuseRelayClient {
  pullBatches(after: string | null): Promise<MusePullResult>
  publishLedger(ledger: MuseLedger): Promise<void>
}

interface BatchPage {
  batches: Array<{ id: string; receivedAt: string; batch: unknown }>
  hasMore: boolean
  nextCursor: string | null
  oldestId: string | null
}

const MAX_PAGES = 20

export function createMuseRelayClient({
  baseUrl = '/api/muse',
  getKey,
  fetchImpl = (input, init) => fetch(input, init),
}: {
  baseUrl?: string
  getKey: () => string | null
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
}): MuseRelayClient {
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const key = getKey()
    if (!key) throw new MuseRelayError('missing-key', 'Add your Paceboard sync key to connect Muse.')
    let response: Response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${key}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      })
    } catch {
      throw new MuseRelayError('network', 'Paceboard could not reach the Muse relay. It will try again automatically.')
    }
    if (response.ok) return response
    if (response.status === 401) throw new MuseRelayError('unauthorized', 'The sync key was rejected. Paste the current Paceboard sync key to reconnect.')
    if (response.status === 503) throw new MuseRelayError('unconfigured', 'The Muse relay is not set up on this deployment yet.')
    if (response.status === 400 || response.status === 413) {
      const body = await response.json().catch(() => null) as { error?: unknown } | null
      throw new MuseRelayError('invalid', typeof body?.error === 'string' ? body.error : 'The Muse relay rejected the request.')
    }
    throw new MuseRelayError('server', 'The Muse relay is temporarily unavailable. Paceboard will try again automatically.')
  }

  return {
    async pullBatches(after) {
      const batches: MuseIncomingBatch[] = []
      let cursor = after
      let oldestId: string | null = null
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams(cursor ? { after: cursor } : {})
        const body = await (await request(`/batches${params.size ? `?${params}` : ''}`)).json() as BatchPage
        if (page === 0) oldestId = body.oldestId ?? null
        for (const item of body.batches ?? []) {
          // The relay validates on write; re-checking keeps a corrupted record from reaching the planner.
          const result = validateMuseBatch(item.batch)
          if (result.ok) batches.push({ id: item.id, receivedAt: item.receivedAt, batch: result.batch as MuseBatch })
        }
        cursor = body.nextCursor ?? cursor
        if (!body.hasMore) break
      }
      return { batches, cursor, oldestId }
    },

    async publishLedger(ledger) {
      await request('/ledger', { method: 'PUT', body: JSON.stringify(ledger) })
    },
  }
}
