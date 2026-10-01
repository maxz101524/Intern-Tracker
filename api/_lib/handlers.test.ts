// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { MUSE_BATCH_SCHEMA, MUSE_LEDGER_SCHEMA } from '../../shared/museContract.js'
import { handleBatches, handleLedger, type RelayDeps } from './handlers.js'
import { createMemoryStore, type RelayStore } from './store.js'

const MUSE_KEY = 'muse-secret'
const PACEBOARD_KEY = 'paceboard-secret'
const BASE = 'https://paceboard.example/api/muse'

function batch(batchId: string) {
  return {
    schema: MUSE_BATCH_SCHEMA,
    batchId,
    generatedAt: '2026-10-01T18:00:00Z',
    newEntries: [{ id: `entry-${batchId}`, company: 'Acme', title: 'ML Intern', submittedDate: '2026-10-01', effort: 'quick' }],
    statusUpdates: [],
  }
}

const ledger = {
  schema: MUSE_LEDGER_SCHEMA, generatedAt: '2026-10-01T18:00:00Z', pendingMuseReview: 0,
  vocabulary: { sources: ['LinkedIn'], resumeVariants: ['ML'] },
  entries: [{ id: 'a', company: 'Acme', title: 'ML Intern', submittedDate: '2026-10-01', status: 'applied', statusHistory: [] }],
}

function request(method: string, path: string, key?: string, body?: unknown) {
  return new Request(`${BASE}${path}`, {
    method,
    headers: key ? { authorization: `Bearer ${key}`, 'content-type': 'application/json' } : {},
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('Muse relay', () => {
  let store: RelayStore
  let clock: number
  let deps: RelayDeps

  beforeEach(() => {
    store = createMemoryStore()
    clock = Date.parse('2026-10-01T18:00:00Z')
    deps = { env: { MUSE_SYNC_KEY: MUSE_KEY, PACEBOARD_SYNC_KEY: PACEBOARD_KEY }, store: () => store, now: () => new Date(clock) }
  })

  async function post(id: string) {
    clock += 1000
    return handleBatches(request('POST', '/batches', MUSE_KEY, batch(id)), deps)
  }

  it('requires the right key for each operation', async () => {
    expect((await handleBatches(request('GET', '/batches'), deps)).status).toBe(401)
    expect((await handleBatches(request('GET', '/batches', 'wrong'), deps)).status).toBe(401)
    expect((await handleBatches(request('GET', '/batches', MUSE_KEY), deps)).status).toBe(401)
    expect((await handleBatches(request('POST', '/batches', PACEBOARD_KEY, batch('a')), deps)).status).toBe(401)
    expect((await handleLedger(request('GET', '/ledger', PACEBOARD_KEY), deps)).status).toBe(401)
    expect((await handleLedger(request('PUT', '/ledger', MUSE_KEY, ledger), deps)).status).toBe(401)
  })

  it('reports an unconfigured relay without revealing details', async () => {
    const missingKeys = await handleBatches(request('GET', '/batches', PACEBOARD_KEY), { ...deps, env: {} })
    expect(missingKeys.status).toBe(503)
    const missingStore = await handleBatches(request('GET', '/batches', PACEBOARD_KEY), { ...deps, store: () => null })
    expect(missingStore.status).toBe(503)
    expect(await missingStore.json()).toEqual({ error: expect.stringContaining('storage') })
  })

  it('validates batches and explains each problem', async () => {
    const malformed = await handleBatches(request('POST', '/batches', MUSE_KEY, '{nope'), deps)
    expect(malformed.status).toBe(400)
    const invalid = await handleBatches(request('POST', '/batches', MUSE_KEY, { ...batch('x'), batchId: '' }), deps)
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toMatchObject({ issues: [{ path: 'batchId' }] })
    const huge = await handleBatches(request('POST', '/batches', MUSE_KEY, { ...batch('big'), padding: 'x'.repeat(300_000) }), deps)
    expect(huge.status).toBe(413)
  })

  it('stores a batch once even when Muse retries', async () => {
    const first = await post('run-1')
    expect(first.status).toBe(201)
    const { id } = await first.json()
    const retry = await post('run-1')
    expect(retry.status).toBe(200)
    expect(await retry.json()).toEqual({ id, duplicate: true })
  })

  it('pages batches after a cursor in arrival order', async () => {
    for (const name of ['a', 'b', 'c']) await post(name)
    const firstPage = await handleBatches(request('GET', '/batches?limit=2', PACEBOARD_KEY), deps)
    const first = await firstPage.json()
    expect(first.batches.map((item: { batch: { batchId: string } }) => item.batch.batchId)).toEqual(['a', 'b'])
    expect(first).toMatchObject({ hasMore: true, nextCursor: first.batches[1].id, oldestId: first.batches[0].id })

    const secondPage = await handleBatches(request('GET', `/batches?after=${first.nextCursor}`, PACEBOARD_KEY), deps)
    const second = await secondPage.json()
    expect(second.batches.map((item: { batch: { batchId: string } }) => item.batch.batchId)).toEqual(['c'])
    expect(second.hasMore).toBe(false)

    const empty = await (await handleBatches(request('GET', `/batches?after=${second.nextCursor}`, PACEBOARD_KEY), deps)).json()
    expect(empty).toMatchObject({ batches: [], hasMore: false, nextCursor: second.nextCursor })
  })

  it('returns an empty first page and rejects malformed cursors', async () => {
    const empty = await (await handleBatches(request('GET', '/batches', PACEBOARD_KEY), deps)).json()
    expect(empty).toEqual({ batches: [], hasMore: false, nextCursor: null, oldestId: null })
    expect((await handleBatches(request('GET', '/batches?after=yesterday', PACEBOARD_KEY), deps)).status).toBe(400)
  })

  it('round-trips the ledger between Paceboard and Muse', async () => {
    expect((await handleLedger(request('GET', '/ledger', MUSE_KEY), deps)).status).toBe(404)
    expect((await handleLedger(request('PUT', '/ledger', PACEBOARD_KEY, { ...ledger, schema: 'x' }), deps)).status).toBe(400)
    expect((await handleLedger(request('PUT', '/ledger', PACEBOARD_KEY, ledger), deps)).status).toBe(200)
    const read = await handleLedger(request('GET', '/ledger', MUSE_KEY), deps)
    expect(await read.json()).toEqual(ledger)
  })

  it('rejects unsupported methods', async () => {
    const response = await handleBatches(request('DELETE', '/batches', MUSE_KEY), deps)
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, POST')
  })

  it('reports store outages as a retryable error', async () => {
    const broken: RelayStore = { ...store, readBatches: async () => { throw new Error('redis down: secret-url') } }
    const response = await handleBatches(request('GET', '/batches', PACEBOARD_KEY), { ...deps, store: () => broken })
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('secret-url')
  })
})
