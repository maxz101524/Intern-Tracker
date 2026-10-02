import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MUSE_BATCH_SCHEMA, type MuseBatch } from '../../shared/museContract'
import type { MuseIncomingBatch } from '../domain/muse'
import { TrackerRepository } from '../storage/repository'
import { MuseRelayError, type MuseRelayClient } from './client'
import { pullMuse } from './sync'

function fakeClient(batches: MuseIncomingBatch[]): MuseRelayClient & { failNext?: boolean } {
  const client: MuseRelayClient & { failNext?: boolean } = {
    async pullBatches(after) {
      if (client.failNext) throw new MuseRelayError('network', 'offline')
      const newer = batches.filter((item) => !after || Number(item.id.split('-')[0]) > Number(after.split('-')[0]))
      return { batches: newer, cursor: newer.at(-1)?.id ?? after, oldestId: batches[0]?.id ?? null }
    },
    async publishLedger() {},
  }
  return client
}

function incoming(id: string, batch: Partial<MuseBatch>): MuseIncomingBatch {
  return {
    id,
    receivedAt: '2026-10-02T12:00:00Z',
    batch: { schema: MUSE_BATCH_SCHEMA, batchId: `run-${id}`, generatedAt: '2026-10-02T12:00:00Z', newEntries: [], statusUpdates: [], decisions: [], closeDecisions: [], ...batch },
  }
}

describe('pullMuse', () => {
  let repository: TrackerRepository

  beforeEach(() => { repository = new TrackerRepository(`paceboard-muse-sync-${crypto.randomUUID()}`) })
  afterEach(async () => { await repository.destroy() })

  const role = { id: 'm-1', company: 'Acme', title: 'ML Intern', submittedDate: '2026-10-01', effort: 'quick' as const }

  it('records an empty pull without moving the cursor', async () => {
    const outcome = await pullMuse({ client: fakeClient([]), repository, now: new Date('2026-10-02T12:00:00Z') })
    expect(outcome).toMatchObject({ batches: 0, summary: { created: 0 } })
    expect((await repository.getMuseData()).syncState).toEqual({ key: 'muse', lastPulledAt: '2026-10-02T12:00:00.000Z', retentionGap: false })
  })

  it('applies new batches once and is idempotent on the next pull', async () => {
    const client = fakeClient([incoming('1000-0', { newEntries: [role] })])
    const first = await pullMuse({ client, repository })
    expect(first.summary.created).toBe(1)
    expect(await repository.listEntries()).toHaveLength(1)
    expect((await repository.getMuseData()).syncState.cursor).toBe('1000-0')

    const second = await pullMuse({ client, repository })
    expect(second.batches).toBe(0)

    await repository.saveMuseSyncState({ key: 'muse' })
    const replay = await pullMuse({ client, repository })
    expect(replay.summary).toMatchObject({ created: 0, skipped: 0 })
    expect(await repository.listEntries()).toHaveLength(1)
  })

  it('stores Muse questions and closes them when Muse says so', async () => {
    const question = { id: 'q-1', kind: 'login' as const, question: 'Intuit sign-in failed twice. Take over?', options: [{ value: 'takeover', label: 'I’ll take over' }] }
    const client = fakeClient([incoming('1000-0', { decisions: [question] })])
    const first = await pullMuse({ client, repository })
    expect(first.newDecisions).toBe(1)
    expect((await repository.getMuseData()).decisions).toEqual([expect.objectContaining({ id: 'q-1', state: 'open' })])

    const closing = fakeClient([incoming('1000-0', { decisions: [question] }), incoming('2000-0', { closeDecisions: ['q-1'] })])
    await pullMuse({ client: closing, repository })
    expect((await repository.getMuseData()).decisions).toEqual([expect.objectContaining({ id: 'q-1', state: 'closed' })])
  })

  it('leaves data untouched when the relay is unreachable', async () => {
    const client = fakeClient([incoming('1000-0', { newEntries: [role] })])
    client.failNext = true
    await expect(pullMuse({ client, repository })).rejects.toMatchObject({ code: 'network' })
    expect(await repository.getMuseData()).toEqual({ items: [], decisions: [], syncState: { key: 'muse' } })
  })

  it('flags a possible retention gap after a long absence', async () => {
    await repository.saveMuseSyncState({ key: 'muse', cursor: '1-0', lastPulledAt: '2026-06-01T00:00:00Z' })
    const outcome = await pullMuse({ client: fakeClient([]), repository, now: new Date('2026-10-02T12:00:00Z') })
    expect(outcome.retentionGap).toBe(true)
  })
})
