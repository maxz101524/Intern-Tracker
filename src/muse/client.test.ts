import { describe, expect, it, vi } from 'vitest'
import { MUSE_BATCH_SCHEMA, MUSE_LEDGER_SCHEMA, type MuseLedger } from '../../shared/museContract'
import { createMuseRelayClient, MuseRelayError } from './client'

function batch(batchId: string) {
  return { schema: MUSE_BATCH_SCHEMA, batchId, generatedAt: '2026-10-02T12:00:00Z', newEntries: [], statusUpdates: [] }
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('Muse relay client', () => {
  it('follows pages from the stored cursor with the sync key', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(respond(200, { batches: [{ id: '1-0', receivedAt: 'r', batch: batch('a') }], hasMore: true, nextCursor: '1-0', oldestId: '1-0' }))
      .mockResolvedValueOnce(respond(200, { batches: [{ id: '2-0', receivedAt: 'r', batch: batch('b') }, { id: '3-0', receivedAt: 'r', batch: { broken: true } }], hasMore: false, nextCursor: '3-0', oldestId: '1-0' }))
    const client = createMuseRelayClient({ getKey: () => 'secret', fetchImpl })

    const result = await client.pullBatches('0-5')

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/muse/batches?after=0-5', expect.objectContaining({ headers: { authorization: 'Bearer secret' } }))
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/muse/batches?after=1-0', expect.anything())
    expect(result.batches.map((item) => item.batch.batchId)).toEqual(['a', 'b'])
    expect(result).toMatchObject({ cursor: '3-0', oldestId: '1-0' })
  })

  it('publishes the ledger as JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(200, { ok: true }))
    const ledger: MuseLedger = { schema: MUSE_LEDGER_SCHEMA, generatedAt: 'g', pendingMuseReview: 0, vocabulary: { sources: [], resumeVariants: [] }, entries: [] }
    await createMuseRelayClient({ getKey: () => 'secret', fetchImpl }).publishLedger(ledger)
    expect(fetchImpl).toHaveBeenCalledWith('/api/muse/ledger', expect.objectContaining({ method: 'PUT', body: JSON.stringify(ledger) }))
  })

  it('maps failures to safe, specific errors without exposing the key', async () => {
    const cases: Array<[Response | Error, string]> = [
      [respond(401, {}), 'unauthorized'],
      [respond(503, {}), 'unconfigured'],
      [respond(400, { error: 'Bad cursor' }), 'invalid'],
      [respond(500, {}), 'server'],
      [new TypeError('Failed to fetch'), 'network'],
    ]
    for (const [outcome, code] of cases) {
      const fetchImpl = outcome instanceof Error ? vi.fn().mockRejectedValue(outcome) : vi.fn().mockResolvedValue(outcome)
      const error = await createMuseRelayClient({ getKey: () => 'secret', fetchImpl }).pullBatches(null).catch((caught) => caught)
      expect(error).toBeInstanceOf(MuseRelayError)
      expect(error.code).toBe(code)
      expect(error.message).not.toContain('secret')
    }
    const missing = await createMuseRelayClient({ getKey: () => null, fetchImpl: vi.fn() }).pullBatches(null).catch((caught) => caught)
    expect(missing.code).toBe('missing-key')
  })
})
