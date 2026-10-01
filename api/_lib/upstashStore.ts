import { Redis } from '@upstash/redis'
import type { MuseBatch, MuseLedger } from '../../shared/museContract.js'
import type { RelayEnv } from './env.js'
import { compareStreamIds, nextStreamId, type RelayStore, type StoredBatch } from './store.js'

const STREAM_KEY = 'muse:batches'
const LEDGER_KEY = 'paceboard:ledger'
const batchKey = (batchId: string) => `muse:batch:${batchId}`

export function createUpstashStore(env: RelayEnv): RelayStore | null {
  const url = env.UPSTASH_REDIS_REST_URL ?? env.KV_REST_API_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN ?? env.KV_REST_API_TOKEN
  if (!url || !token) return null
  const redis = new Redis({ url, token })

  return {
    async appendBatch(batch, receivedAt, retentionMs) {
      const existing = await redis.get(batchKey(batch.batchId))
      if (existing) return { id: String(existing), duplicate: true }

      const id = await redis.xadd(
        STREAM_KEY,
        '*',
        { batchId: batch.batchId, receivedAt, batch: JSON.stringify(batch) },
        { trim: { type: 'MINID', threshold: `${Date.parse(receivedAt) - retentionMs}-0`, comparison: '~' } },
      )
      const claimed = await redis.set(batchKey(batch.batchId), id, { nx: true, ex: Math.ceil(retentionMs / 1000) })
      if (claimed === null) {
        // Another request stored this batch between our check and append; keep the earlier copy.
        await redis.xdel(STREAM_KEY, id)
        return { id: String(await redis.get(batchKey(batch.batchId))), duplicate: true }
      }
      return { id, duplicate: false }
    },

    async readBatches(after, limit) {
      const start = after ? nextStreamId(after) : '-'
      const [page, oldest] = await Promise.all([
        redis.xrange(STREAM_KEY, start, '+', limit + 1),
        redis.xrange(STREAM_KEY, '-', '+', 1),
      ])
      const batches = Object.entries(page ?? {})
        .map(([id, fields]) => toStoredBatch(id, fields as Record<string, unknown>))
        .sort((left, right) => compareStreamIds(left.id, right.id))
      return {
        batches: batches.slice(0, limit),
        hasMore: batches.length > limit,
        oldestId: Object.keys(oldest ?? {})[0] ?? null,
      }
    },

    async getLedger() {
      const value = await redis.get(LEDGER_KEY)
      if (value === null || value === undefined) return null
      return (typeof value === 'string' ? JSON.parse(value) : value) as MuseLedger
    },

    async putLedger(ledger) {
      await redis.set(LEDGER_KEY, JSON.stringify(ledger))
    },
  }
}

function toStoredBatch(id: string, fields: Record<string, unknown>): StoredBatch {
  // The SDK may already have deserialized JSON field values.
  const batch = typeof fields.batch === 'string' ? JSON.parse(fields.batch) : fields.batch
  return { id, receivedAt: String(fields.receivedAt), batch: batch as MuseBatch }
}
