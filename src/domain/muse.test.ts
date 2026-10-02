import { describe, expect, it } from 'vitest'
import { MUSE_BATCH_SCHEMA, type MuseBatch, type MuseEntryPayload, type MuseStatusPayload } from '../../shared/museContract'
import { createApplication } from './entries'
import { createGmailCandidate } from './gmail'
import { buildLedger, fillBlankFields, ledgerHash, planMuseDecisions, planMuseIngest, undoMuseItem, type MuseIncomingBatch } from './muse'
import { normalizeSettings } from './settings'
import { appendStatus } from './status'
import type { ApplicationEntry, GmailCandidate, MuseDecision } from './types'

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
  const batch: MuseBatch = { schema: MUSE_BATCH_SCHEMA, batchId: `batch-${id}`, generatedAt: RECEIVED, newEntries, statusUpdates, decisions: [], closeDecisions: [] }
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

describe('planMuseIngest — repeated rounds', () => {
  it('records a same-stage update only when Muse marks it a new round', () => {
    const firstRound = appendStatus(entry({ id: 'muse-entry-1', nextAction: 'Complete the online assessment — Round 1', nextActionDueDate: '2026-09-25' }), 'online_assessment', '2026-09-22', undefined, 'round-1')

    const repeat = plan([incoming([], [statusPayload({ date: '2026-10-01' })])], [firstRound])
    expect(repeat.items[0].state).toBe('skipped')

    const secondRound = plan([incoming([], [statusPayload({ date: '2026-10-01', newRound: true, note: 'Round 2', dueDate: '2026-10-06' })])], [firstRound])
    expect(secondRound.items[0]).toMatchObject({ state: 'applied', result: { nextActionSet: true } })
    expect(secondRound.entryWrites[0].statusHistory.map(({ status, date }) => `${status}@${date}`)).toEqual([
      'applied@2026-09-20', 'online_assessment@2026-09-22', 'online_assessment@2026-10-01',
    ])
    expect(secondRound.entryWrites[0]).toMatchObject({ nextAction: 'Complete the online assessment — Round 2', nextActionDueDate: '2026-10-06' })

    const ownPlan = { ...firstRound, nextAction: 'Ask Priya about the format' }
    const kept = plan([incoming([], [statusPayload({ date: '2026-10-01', newRound: true, dueDate: '2026-10-06' })])], [ownPlan])
    expect(kept.entryWrites[0].nextAction).toBe('Ask Priya about the format')
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

describe('Muse decisions', () => {
  const question = {
    id: 'decision-1', kind: 'pay' as const, question: 'Pay is not listed. Apply anyway?', company: 'Delta', role: 'Data Science Intern',
    options: [{ value: 'apply', label: 'Apply' }, { value: 'skip', label: 'Skip' }],
  }
  const withDecisions = (id: string, decisions: typeof question[], closeDecisions: string[] = []): MuseIncomingBatch => ({
    ...incoming([], [], id), batch: { ...incoming([], [], id).batch, decisions, closeDecisions },
  })

  it('opens new questions once and lets Muse close open ones', () => {
    const opened = planMuseDecisions([withDecisions('1000-0', [question])], [], RECEIVED)
    expect(opened).toEqual([expect.objectContaining({ id: 'decision-1', state: 'open', streamId: '1000-0', receivedAt: RECEIVED })])
    expect(planMuseDecisions([withDecisions('1001-0', [question])], opened, RECEIVED)).toEqual([])

    const closed = planMuseDecisions([withDecisions('1002-0', [], ['decision-1'])], opened, RECEIVED)
    expect(closed).toEqual([expect.objectContaining({ id: 'decision-1', state: 'closed', closedAt: RECEIVED })])

    const answered: MuseDecision = { ...opened[0], state: 'answered', answer: { value: 'apply', label: 'Apply', answeredAt: RECEIVED } }
    expect(planMuseDecisions([withDecisions('1003-0', [], ['decision-1'])], [answered], RECEIVED)).toEqual([])
  })

  it('publishes recent answers and open question ids in the ledger', () => {
    const settings = normalizeSettings({ weeklyTarget: 10 })
    const decisions: MuseDecision[] = [
      { id: 'a', batchId: 'b', streamId: '1-0', payload: { ...question, id: 'a' }, state: 'answered', receivedAt: RECEIVED, answer: { value: 'apply', label: 'Apply', note: 'Delta pays well', answeredAt: RECEIVED } },
      { id: 'old', batchId: 'b', streamId: '1-0', payload: { ...question, id: 'old' }, state: 'answered', receivedAt: RECEIVED, answer: { value: 'skip', label: 'Skip', answeredAt: '2026-08-01T00:00:00.000Z' } },
      { id: 'open', batchId: 'b', streamId: '1-0', payload: { ...question, id: 'open' }, state: 'open', receivedAt: RECEIVED },
    ]
    const ledger = buildLedger([], settings, { key: 'muse' }, 1, RECEIVED, decisions)
    expect(ledger.decisionAnswers).toEqual([{ id: 'a', value: 'apply', note: 'Delta pays well', answeredAt: RECEIVED }])
    expect(ledger.openDecisionIds).toEqual(['open'])
  })

  it('keeps Muse’s posting date on new roles', () => {
    const result = plan([incoming([entryPayload({ postedDate: '2026-09-29' })])])
    expect(result.entryWrites[0].postedDate).toBe('2026-09-29')
  })
})
