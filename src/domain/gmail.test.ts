import { describe, expect, it } from 'vitest'
import { createApplication } from './entries'
import { createGmailCandidate, findPossibleDuplicate, matchGmailStatusToApplications } from './gmail'

describe('Gmail import domain rules', () => {
  it('normalizes a pending review candidate', () => {
    const candidate = createGmailCandidate({
      messageId: 'gmail-1',
      threadId: 'thread-1',
      receivedAt: '2026-09-10T13:30:00.000Z',
      submittedDate: '2026-09-10',
      sender: ' Acme Recruiting <jobs@acme.com> ',
      subject: ' Application received — Data Science Intern ',
      company: ' Acme ',
      title: ' Data Science Intern ',
      confidence: 'high',
      matchedRule: 'generic-confirmation',
    })

    expect(candidate).toMatchObject({
      company: 'Acme',
      title: 'Data Science Intern',
      sender: 'Acme Recruiting <jobs@acme.com>',
      state: 'pending',
    })
    expect(new Date(candidate.createdAt).toISOString()).toBe(candidate.createdAt)
  })

  it('rejects invalid candidate identity, timestamps, dates, and confidence', () => {
    const valid = {
      messageId: 'gmail-1', threadId: 'thread-1', receivedAt: '2026-09-10T13:30:00.000Z',
      submittedDate: '2026-09-10', sender: 'jobs@acme.com', subject: 'Received',
      company: 'Acme', title: 'Data Science Intern', confidence: 'high' as const,
      matchedRule: 'generic-confirmation',
    }

    expect(() => createGmailCandidate({ ...valid, messageId: '' })).toThrow('Gmail message ID is required.')
    expect(() => createGmailCandidate({ ...valid, receivedAt: 'yesterday' })).toThrow('Gmail receipt time is not valid.')
    expect(() => createGmailCandidate({ ...valid, submittedDate: '2026-02-30' })).toThrow('Gmail submission date is not valid.')
    expect(() => createGmailCandidate({ ...valid, confidence: 'low' as 'high' })).toThrow('Gmail confidence is not valid.')
  })

  it('finds exact and near semantic duplicates without blocking different roles', () => {
    const existing = createApplication({
      company: 'ACME, Inc.', title: 'Data-Science Intern', submittedDate: '2026-09-10', effort: 'quick',
    })
    const candidate = createGmailCandidate({
      messageId: 'gmail-1', threadId: 'thread-1', receivedAt: '2026-09-10T13:30:00.000Z',
      submittedDate: '2026-09-10', sender: 'jobs@acme.com', subject: 'Received',
      company: 'Acme Inc', title: 'Data Science Intern', confidence: 'high', matchedRule: 'generic-confirmation',
    })

    expect(findPossibleDuplicate(candidate, [existing])).toEqual({ kind: 'exact', entryId: existing.id })
    expect(findPossibleDuplicate({ ...candidate, submittedDate: '2026-09-12' }, [existing]))
      .toEqual({ kind: 'near', entryId: existing.id })
    expect(findPossibleDuplicate({ ...candidate, submittedDate: '2026-09-15' }, [existing]))
      .toEqual({ kind: 'near', entryId: existing.id })
    expect(findPossibleDuplicate({ ...candidate, submittedDate: '2026-09-25' }, [existing])).toBeNull()
    expect(findPossibleDuplicate({ ...candidate, title: 'Software Intern' }, [existing])).toBeNull()
  })

  it('matches company aliases and normalized role titles to one existing application', () => {
    const entry = createApplication({
      company: 'Daikin Comfort Technologies, Inc.', title: 'Data Engineering Intern', submittedDate: '2026-09-08', effort: 'quick',
    })
    expect(matchGmailStatusToApplications({
      company: 'Daikin', title: 'Data Engineering Intern, Summer 2027', sender: 'notifications@ripplematch.com',
    }, [entry])).toEqual([entry.id])
  })
})
