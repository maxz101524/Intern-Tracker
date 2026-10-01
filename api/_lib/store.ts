import { compareStreamIds, type MuseBatch, type MuseLedger } from '../../shared/museContract.js'

export { compareStreamIds, nextStreamId, STREAM_ID_PATTERN } from '../../shared/museContract.js'

export interface StoredBatch {
  id: string
  receivedAt: string
  batch: MuseBatch
}

export interface RelayStore {
  appendBatch(batch: MuseBatch, receivedAt: string, retentionMs: number): Promise<{ id: string; duplicate: boolean }>
  readBatches(after: string | null, limit: number): Promise<{ batches: StoredBatch[]; hasMore: boolean; oldestId: string | null }>
  getLedger(): Promise<MuseLedger | null>
  putLedger(ledger: MuseLedger): Promise<void>
}

export function createMemoryStore(): RelayStore {
  const stream: StoredBatch[] = []
  const batchIds = new Map<string, string>()
  let ledger: MuseLedger | null = null
  let lastMs = 0
  let sequence = 0

  return {
    async appendBatch(batch, receivedAt, retentionMs) {
      const existing = batchIds.get(batch.batchId)
      if (existing) return { id: existing, duplicate: true }
      const ms = Math.max(Date.parse(receivedAt), lastMs)
      sequence = ms === lastMs ? sequence + 1 : 0
      lastMs = ms
      const id = `${ms}-${sequence}`
      stream.push({ id, receivedAt, batch: structuredClone(batch) })
      batchIds.set(batch.batchId, id)
      const minimum = Date.parse(receivedAt) - retentionMs
      while (stream.length && Number(stream[0].id.split('-')[0]) < minimum) stream.shift()
      return { id, duplicate: false }
    },
    async readBatches(after, limit) {
      const newer = stream.filter((item) => !after || compareStreamIds(item.id, after) > 0)
      return {
        batches: newer.slice(0, limit).map((item) => structuredClone(item)),
        hasMore: newer.length > limit,
        oldestId: stream[0]?.id ?? null,
      }
    },
    async getLedger() {
      return ledger ? structuredClone(ledger) : null
    },
    async putLedger(next) {
      ledger = structuredClone(next)
    },
  }
}
