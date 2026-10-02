import { describe, expect, it } from 'vitest'
import { MUSE_BATCH_SCHEMA, MUSE_LEDGER_SCHEMA, MUSE_MAX_ITEMS, validateLedger, validateMuseBatch } from './museContract'

function batch(overrides: Record<string, unknown> = {}) {
  return {
    schema: MUSE_BATCH_SCHEMA,
    batchId: 'run-1',
    generatedAt: '2026-10-01T18:07:12Z',
    newEntries: [{
      id: 'entry-1', company: 'Scale AI', title: 'ML Research Intern', submittedDate: '2026-10-01', effort: 'quick',
      source: 'Company site', url: 'https://example.com/job', resumeVariant: 'ML', notes: '$52/hr',
      origin: { provider: 'gmail', messageId: 'msg-1' },
    }],
    statusUpdates: [{
      id: 'event-1', entryId: 'entry-1', status: 'online_assessment', date: '2026-10-03',
      origin: { provider: 'gmail', messageId: 'msg-2' }, note: 'HackerRank',
    }],
    ...overrides,
  }
}

function issuesOf(value: unknown) {
  const result = validateMuseBatch(value)
  if (result.ok) throw new Error('expected validation to fail')
  return result.issues.map((issue) => issue.path)
}

describe('validateMuseBatch', () => {
  it('accepts a valid batch and fills defaults', () => {
    const result = validateMuseBatch(batch())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.batch.statusUpdates[0].confidence).toBe('high')
    expect(result.batch.newEntries[0]).toMatchObject({ id: 'entry-1', resumeVariant: 'ML' })
  })

  it('defaults missing item arrays to empty lists', () => {
    const result = validateMuseBatch({ schema: MUSE_BATCH_SCHEMA, batchId: 'run-2', generatedAt: '2026-10-01T18:07:12Z' })
    expect(result.ok && result.batch).toMatchObject({ newEntries: [], statusUpdates: [], decisions: [], closeDecisions: [] })
  })

  it('accepts posting dates and decisions, and rejects malformed decisions', () => {
    const decision = {
      id: 'decision-1', kind: 'pay', question: 'Pay is not listed. Apply anyway?', company: 'Delta', role: 'Data Science Intern',
      url: 'https://delta.example/job', options: [{ value: 'apply', label: 'Apply' }, { value: 'skip', label: 'Skip' }],
    }
    const result = validateMuseBatch(batch({
      newEntries: [{ ...batch().newEntries[0], postedDate: '2026-09-30' }],
      decisions: [decision],
      closeDecisions: ['decision-0'],
    }))
    expect(result.ok && result.batch).toMatchObject({ newEntries: [{ postedDate: '2026-09-30' }], decisions: [decision], closeDecisions: ['decision-0'] })
    expect(issuesOf(batch({ decisions: [{ ...decision, kind: 'vibes' }] }))).toContain('decisions[0].kind')
    expect(issuesOf(batch({ decisions: [{ ...decision, options: [] }] }))).toContain('decisions[0].options')
    expect(issuesOf(batch({ newEntries: [{ ...batch().newEntries[0], postedDate: 'last week' }] }))).toContain('newEntries[0].postedDate')
  })

  it('accepts a status update targeted by company, title, and submission date', () => {
    const result = validateMuseBatch(batch({ statusUpdates: [{
      id: 'event-2', match: { company: 'Scale AI', title: 'ML Intern', submittedDate: '2026-10-01' },
      status: 'rejected', date: '2026-10-09', confidence: 'low',
    }] }))
    expect(result.ok && result.batch.statusUpdates[0]).toMatchObject({ confidence: 'low', match: { company: 'Scale AI' } })
  })

  it('reports the path of each shape problem', () => {
    expect(issuesOf('nope')).toEqual(['$'])
    expect(issuesOf(batch({ schema: 'other' }))).toContain('schema')
    expect(issuesOf(batch({ batchId: ' ' }))).toContain('batchId')
    expect(issuesOf(batch({ generatedAt: 'yesterday' }))).toContain('generatedAt')
    expect(issuesOf(batch({ newEntries: [{ ...batch().newEntries[0], submittedDate: '2026-02-30' }] }))).toContain('newEntries[0].submittedDate')
    expect(issuesOf(batch({ newEntries: [{ ...batch().newEntries[0], effort: 'huge' }] }))).toContain('newEntries[0].effort')
    expect(issuesOf(batch({ newEntries: [{ ...batch().newEntries[0], origin: { provider: 'outlook', messageId: 'x' } }] }))).toContain('newEntries[0].origin')
    expect(issuesOf(batch({ statusUpdates: [{ ...batch().statusUpdates[0], status: 'applied' }] }))).toContain('statusUpdates[0].status')
    expect(issuesOf(batch({ statusUpdates: [{ ...batch().statusUpdates[0], entryId: undefined }] }))).toContain('statusUpdates[0].entryId')
    expect(issuesOf(batch({ statusUpdates: [{ ...batch().statusUpdates[0], confidence: 'medium' }] }))).toContain('statusUpdates[0].confidence')
    expect(issuesOf(batch({ statusUpdates: [{ ...batch().statusUpdates[0], newRound: 'yes' }] }))).toContain('statusUpdates[0].newRound')
  })

  it('rejects batches with too many items', () => {
    const entry = batch().newEntries[0]
    const newEntries = Array.from({ length: MUSE_MAX_ITEMS + 1 }, (_, index) => ({ ...entry, id: `entry-${index}` }))
    expect(issuesOf(batch({ newEntries, statusUpdates: [] }))).toContain('$')
  })
})

describe('validateLedger', () => {
  it('accepts a ledger and rejects the wrong schema', () => {
    const ledger = {
      schema: MUSE_LEDGER_SCHEMA, generatedAt: '2026-10-01T18:07:12Z', pendingMuseReview: 0,
      vocabulary: { sources: ['LinkedIn'], resumeVariants: ['ML'] },
      entries: [{ id: 'a', company: 'Acme', title: 'Intern', submittedDate: '2026-09-01', status: 'applied', statusHistory: [{ id: 'e', status: 'applied', date: '2026-09-01' }] }],
    }
    expect(validateLedger(ledger).ok).toBe(true)
    expect(validateLedger({ ...ledger, schema: 'x' }).ok).toBe(false)
    expect(validateLedger([]).ok).toBe(false)
  })
})
