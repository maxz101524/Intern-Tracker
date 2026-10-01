import { describe, expect, it } from 'vitest'
import { MUSE_BATCH_SCHEMA, type MuseBatch, type MuseEntryPayload, type MuseStatusPayload } from '../../shared/museContract'
import { createApplication } from './entries'
import { createGmailCandidate } from './gmail'
import { buildLedger, fillBlankFields, ledgerHash, planMuseIngest, undoMuseItem, type MuseIncomingBatch } from './muse'
import { normalizeSettings } from './settings'
import { appendStatus } from './status'
import type { ApplicationEntry, GmailCandidate } from './types'

const RECEIVED = '2026-10-02T12:00:00.000Z'

function entryPayload(overrides: Partial<MuseEntryPayload> = {}): MuseEntryPayload {
  return {
    id: 'muse-entry-1', company: 'Scale AI', title: 'ML Research Intern', submittedDate: '2026-10-01', effort: 'quick',
    source: 'Company site', url: 'https://scale.example/jobs/1', resumeVariant: 'ML', notes: '$52/hr · SF',
    ...overrides,
  }
}

function statusPayload(overrides: Partial<MuseStatusPayload> = {}): MuseStatusPayload {
  return { id: 'muse-event-1', entryId: 'muse-entry-1', status: 'online_assessment', date: '2026-10-03', confidence: 'high', ...overrides }
}

function incoming(newEntries: MuseEntryPayload[] = [], statusUpdates: MuseStatusPayload[] = [], id = '1000-0'): MuseIncomingBatch {
  const batch: MuseBatch = { schema: MUSE_BATCH_SCHEMA, batchId: `batch-${id}`, generatedAt: RECEIVED, newEntries, statusUpdates }
  return { id, receivedAt: RECEIVED, batch }
}

function entry(overrides: Partial<Parameters<typeof createApplication>[0]> = {}): ApplicationEntry {
  return createApplication({ company: 'Acme', title: 'Data Science Intern', submittedDate: '2026-09-20', effort: 'quick', ...overrides })
}

function plan(batches: MuseIncomingBatch[], entries: ApplicationEntry[] = [], options: { knownKeys?: Set<string>; gmailCandidates?: GmailCandidate[] } = {}) {
  return planMuseIngest({
    batches,
    entries,
    knownKeys: options.knownKeys ?? new Set(),
    gmailCandidates: options.gmailCandidates ?? [],
    receivedAt: RECEIVED,
  })
}

describe('planMuseIngest — new entries', () => {
  it('creates a clean role with Muse’s ID and an applied event', () => {
    const result = plan([incoming([entryPayload()])])
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ key: 'entry:muse-entry-1', state: 'applied', streamId: '1000-0', result: { entryId: 'muse-entry-1', action: 'created' } })
    expect(result.entryWrites).toHaveLength(1)
    expect(result.entryWrites[0]).toMatchObject({ id: 'muse-entry-1', company: 'Scale AI', resumeVariant: 'ML', notes: '$52/hr · SF' })
    expect(result.entryWrites[0].statusHistory).toEqual([expect.objectContaining({ status: 'applied', date: '2026-10-01' })])
    expect(result.summary).toMatchObject({ created: 1, review: 0 })
  })

  it('skips roles Paceboard already has and ignores items it has already processed', () => {
    const existing = entry({ id: 'muse-entry-1', company: 'Scale AI', title: 'ML Research Intern', submittedDate: '2026-10-01' })
    expect(plan([incoming([entryPayload()])], [existing]).items[0]).toMatchObject({ state: 'skipped' })
    expect(plan([incoming([entryPayload()])], [], { knownKeys: new Set(['entry:muse-entry-1']) }).items).toEqual([])
  })

  it('fills only blank fields when the confirmation email is already on a role', () => {
    const existing = entry({ company: 'Scale AI', title: 'ML Research Intern', submittedDate: '2026-10-01', notes: 'Mine', origin: { provider: 'gmail', messageId: 'confirm-1' } })
    const result = plan([incoming([entryPayload({ origin: { provider: 'gmail', messageId: 'confirm-1' } })])], [existing])
    expect(result.items[0]).toMatchObject({ state: 'applied', result: { entryId: existing.id, action: 'filled', filledFields: ['url', 'source', 'resumeVariant'] } })
    expect(result.entryWrites[0]).toMatchObject({ id: existing.id, notes: 'Mine', url: 'https://scale.example/jobs/1', resumeVariant: 'ML' })
  })

  it('skips a confirmation match that has nothing left to fill', () => {
    const existing = entry({
      company: 'Scale AI', title: 'ML Research Intern', submittedDate: '2026-10-01', source: 'LinkedIn', url: 'https://x', resumeVariant: 'DS', notes: 'n',
      origin: { provider: 'gmail', messageId: 'confirm-1' },
    })
    const result = plan([incoming([entryPayload({ origin: { provider: 'gmail', messageId: 'confirm-1' } })])], [existing])
    expect(result.items[0]).toMatchObject({ state: 'skipped' })
    expect(result.entryWrites).toEqual([])
  })

  it('sends a likely duplicate to review instead of adding it', () => {
    const existing = entry({ company: 'Scale AI', title: 'Machine Learning Research Intern', submittedDate: '2026-09-30' })
    const result = plan([incoming([entryPayload()])], [existing])
    expect(result.items[0]).toMatchObject({ state: 'pending', reason: 'possible_duplicate', suggestedEntryIds: [existing.id] })
    expect(result.entryWrites).toEqual([])
    expect(result.summary.review).toBe(1)
  })

  it('keeps invalid roles for review with the validation message', () => {
    const result = plan([incoming([entryPayload({ statusHistory: [{ id: 'x', status: 'interview', date: '2026-10-02' }] })])])
    expect(result.items[0]).toMatchObject({ state: 'pending', reason: 'invalid', detail: expect.stringContaining('Status history') })
  })
})

describe('planMuseIngest — status updates', () => {
  it('appends a status by entry ID with Muse’s event ID and Gmail origin', () => {
    const target = entry({ id: 'muse-entry-1' })
    const result = plan([incoming([], [statusPayload({ origin: { provider: 'gmail', messageId: 'oa-1' }, note: 'HackerRank' })])], [target])
    expect(result.items[0]).toMatchObject({ key: 'status:muse-event-1', state: 'applied', result: { entryId: target.id, action: 'status_added' } })
    expect(result.entryWrites[0].statusHistory.at(-1)).toEqual({ id: 'muse-event-1', status: 'online_assessment', date: '2026-10-03', origin: { provider: 'gmail', messageId: 'oa-1' } })
    expect(result.entryWrites[0].notes).toBeUndefined()
  })

  it('resolves an exact company, title, and date match', () => {
    const target = entry({ company: 'Acme, Inc.', title: 'Data Science Intern' })
    const result = plan([incoming([], [statusPayload({ entryId: undefined, match: { company: 'acme inc', title: 'Data-Science Intern', submittedDate: '2026-09-20' } })])], [target])
    expect(result.items[0]).toMatchObject({ state: 'applied', result: { entryId: target.id } })
  })

  it('asks for a role when the target cannot be resolved, with suggestions', () => {
    const target = entry({ company: 'Acme', title: 'Data Science Intern' })
    const result = plan([incoming([], [statusPayload({ entryId: 'missing', match: { company: 'Acme', title: 'Data Science Intern', submittedDate: '2026-09-25' } })])], [target])
    expect(result.items[0]).toMatchObject({ state: 'pending', reason: 'unmatched', suggestedEntryIds: [target.id] })
  })

  it('reviews low-confidence, closed-application, and backdated updates', () => {
    const open = entry({ id: 'muse-entry-1' })
    expect(plan([incoming([], [statusPayload({ confidence: 'low' })])], [open]).items[0]).toMatchObject({ state: 'pending', reason: 'low_confidence', suggestedEntryIds: [open.id] })
    const rejected = appendStatus(entry({ id: 'muse-entry-1' }), 'rejected', '2026-09-28')
    expect(plan([incoming([], [statusPayload()])], [rejected]).items[0]).toMatchObject({ state: 'pending', reason: 'closed_application' })
    expect(plan([incoming([], [statusPayload({ date: '2026-09-01' })])], [open]).items[0]).toMatchObject({ state: 'pending', reason: 'invalid' })
  })

  it('skips events already recorded by ID, Gmail message, or current status', () => {
    const withEvent = appendStatus(entry({ id: 'muse-entry-1' }), 'online_assessment', '2026-10-03', { provider: 'gmail', messageId: 'oa-1' }, 'muse-event-1')
    expect(plan([incoming([], [statusPayload()])], [withEvent]).items[0].state).toBe('skipped')
    expect(plan([incoming([], [statusPayload({ id: 'other', origin: { provider: 'gmail', messageId: 'oa-1' } })])], [withEvent]).items[0].state).toBe('skipped')
    expect(plan([incoming([], [statusPayload({ id: 'other-2', date: '2026-10-05' })])], [withEvent]).items[0].state).toBe('skipped')
  })

  it('applies a new role and its status from the same batch', () => {
    const result = plan([incoming([entryPayload()], [statusPayload()])])
    expect(result.items.map((item) => item.state)).toEqual(['applied', 'applied'])
    expect(result.entryWrites).toHaveLength(1)
    expect(result.entryWrites[0].statusHistory.map((event) => event.status)).toEqual(['applied', 'online_assessment'])
    expect(result.summary).toMatchObject({ created: 1, statuses: 1 })
  })
})

describe('planMuseIngest — deadlines', () => {
  it('turns a Muse deadline into a next action only when the role has no open plan', () => {
    const open = entry({ id: 'muse-entry-1' })
    const withDeadline = plan([incoming([], [statusPayload({ dueDate: '2026-10-08', note: 'HackerRank' })])], [open])
    expect(withDeadline.items[0]).toMatchObject({ result: { nextActionSet: true } })
    expect(withDeadline.entryWrites[0]).toMatchObject({ nextAction: 'Complete the online assessment — HackerRank', nextActionDueDate: '2026-10-08', nextActionCompleted: false })

    const planned = entry({ id: 'muse-entry-1', nextAction: 'Ask Priya for a referral', nextActionDueDate: '2026-10-04' })
    const kept = plan([incoming([], [statusPayload({ dueDate: '2026-10-08' })])], [planned])
    expect(kept.entryWrites[0]).toMatchObject({ nextAction: 'Ask Priya for a referral', nextActionDueDate: '2026-10-04' })
    expect(kept.items[0].result).not.toHaveProperty('nextActionSet')

    const undo = undoMuseItem(withDeadline.items[0], withDeadline.entryWrites)
    expect(undo?.write?.nextAction).toBeUndefined()
    expect(undo?.write?.nextActionDueDate).toBeUndefined()
  })
})

describe('planMuseIngest — Gmail overlap and idempotency', () => {
  it('resolves pending Gmail candidates that refer to the same message', () => {
    const target = entry({ id: 'muse-entry-1' })
    const candidate = createGmailCandidate({
      messageId: 'oa-1', threadId: 't', receivedAt: '2026-10-03T12:00:00Z', submittedDate: '2026-10-03', sender: 'jobs@acme.com',
      subject: 'Assessment', company: 'Acme', title: 'Data Science Intern', confidence: 'high', matchedRule: 'status', kind: 'status',
      suggestedStatus: 'online_assessment', eventDate: '2026-10-03', matchedEntryIds: [target.id],
    })
    const result = plan([incoming([], [statusPayload({ origin: { provider: 'gmail', messageId: 'oa-1' } })])], [target], { gmailCandidates: [candidate] })
    expect(result.gmailResolutions).toEqual([expect.objectContaining({ messageId: 'oa-1', state: 'imported', linkedEntryId: target.id, reviewedAt: RECEIVED })])
  })

  it('produces nothing new when the same batches are planned again', () => {
    const batches = [incoming([entryPayload()], [statusPayload()])]
    const first = plan(batches)
    const second = plan(batches, first.entryWrites, { knownKeys: new Set(first.items.map((item) => item.key)) })
    expect(second.items).toEqual([])
    expect(second.entryWrites).toEqual([])
  })

  it('ignores a repeated item within one pull', () => {
    const result = plan([incoming([entryPayload()]), incoming([entryPayload()], [], '1001-0')])
    expect(result.items).toHaveLength(1)
  })
})

describe('Muse helpers', () => {
  it('fills blanks without touching existing values', () => {
    const existing = entry({ url: 'https://mine' })
    const { entry: filled, fields } = fillBlankFields(existing, entryPayload({ origin: { provider: 'gmail', messageId: 'm' } }))
    expect(fields).toEqual(['source', 'resumeVariant', 'notes', 'origin'])
    expect(filled.url).toBe('https://mine')
  })

  it('undoes created roles, added events, and filled fields', () => {
    const created = plan([incoming([entryPayload()], [statusPayload()])])
    const [entryItem, statusItem] = created.items
    expect(undoMuseItem(entryItem, created.entryWrites)).toEqual({ deleteId: 'muse-entry-1' })
    const statusUndo = undoMuseItem(statusItem, created.entryWrites)
    expect(statusUndo?.write?.statusHistory.map((event) => event.status)).toEqual(['applied'])

    const existing = entry({ company: 'Scale AI', title: 'ML Research Intern', submittedDate: '2026-10-01', origin: { provider: 'gmail', messageId: 'c' } })
    const filled = plan([incoming([entryPayload({ origin: { provider: 'gmail', messageId: 'c' } })])], [existing])
    const edited = { ...filled.entryWrites[0], url: 'https://edited-by-max' }
    const fillUndo = undoMuseItem(filled.items[0], [edited])
    expect(fillUndo?.write).toMatchObject({ url: 'https://edited-by-max' })
    expect(fillUndo?.write?.resumeVariant).toBeUndefined()
    expect(fillUndo?.write?.notes).toBeUndefined()
  })

  it('builds a compact ledger without private fields and hashes it stably', () => {
    const role = appendStatus(entry({ notes: 'secret', nextAction: 'Email recruiter', url: 'https://acme', source: 'LinkedIn' }), 'interview', '2026-09-30')
    const settings = normalizeSettings({ weeklyTarget: 10, sources: ['LinkedIn'], resumeVariants: ['ML'] })
    const ledger = buildLedger([role], settings, { key: 'muse', cursor: '1000-0', lastPulledAt: RECEIVED }, 2, RECEIVED)
    expect(ledger).toMatchObject({ museCursor: '1000-0', pendingMuseReview: 2, vocabulary: { sources: ['LinkedIn'], resumeVariants: ['ML'] } })
    expect(ledger.entries[0]).toEqual({
      id: role.id, company: 'Acme', title: 'Data Science Intern', submittedDate: '2026-09-20', url: 'https://acme', source: 'LinkedIn', status: 'interview',
      statusHistory: role.statusHistory.map(({ id, status, date }) => ({ id, status, date })),
    })
    expect(JSON.stringify(ledger)).not.toContain('secret')
    expect(ledgerHash(ledger)).toBe(ledgerHash({ ...ledger, generatedAt: '2030-01-01T00:00:00.000Z' }))
    expect(ledgerHash(ledger)).not.toBe(ledgerHash({ ...ledger, pendingMuseReview: 3 }))
  })
})
