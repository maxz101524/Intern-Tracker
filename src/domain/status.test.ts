import { describe, expect, it } from 'vitest'
import { createApplication } from './entries'
import { appendStatus, completeNextAction, getCurrentStatus, getDisplayStatus, snoozeNextAction } from './status'

describe('application status history', () => {
  it('derives No response at exactly 21 local calendar days', () => {
    const entry = createApplication({
      company: 'Cigna', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick',
    })

    expect(getDisplayStatus(entry, '2026-09-23')).toBe('applied')
    expect(getDisplayStatus(entry, '2026-09-24')).toBe('no_response')
  })

  it('removes derived No response when a later result arrives', () => {
    const applied = createApplication({
      company: 'Cigna', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick',
    })
    const interviewed = appendStatus(applied, 'interview', '2026-10-02')

    expect(getCurrentStatus(interviewed)).toBe('interview')
    expect(getDisplayStatus(interviewed, '2026-10-20')).toBe('interview')
    expect(interviewed.statusHistory.map(({ status }) => status)).toEqual(['applied', 'interview'])
  })

  it('does not append a duplicate of the current stored status', () => {
    const entry = createApplication({
      company: 'RSM', title: 'Data Science Intern', submittedDate: '2026-09-03', effort: 'targeted',
    })

    expect(appendStatus(entry, 'applied', '2026-09-04')).toBe(entry)
  })

  it('keeps backdated events chronological and rejects pre-submission events', () => {
    let entry = createApplication({
      company: 'RSM', title: 'Data Science Intern', submittedDate: '2026-09-03', effort: 'targeted',
    })
    entry = appendStatus(entry, 'interview', '2026-09-20')
    entry = appendStatus(entry, 'online_assessment', '2026-09-10')

    expect(entry.statusHistory.map(({ status }) => status)).toEqual([
      'applied', 'online_assessment', 'interview',
    ])
    expect(() => appendStatus(entry, 'recruiter_screen', '2026-09-01')).toThrow(
      'Status date cannot be before the submission date.',
    )
  })

  it('records a Gmail event once and manages an optional next action', () => {
    const origin = { provider: 'gmail' as const, messageId: 'message-1' }
    let entry = createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-01', effort: 'quick',
      nextAction: 'Complete assessment', nextActionDueDate: '2026-09-10',
    })
    entry = appendStatus(entry, 'online_assessment', '2026-09-08', origin)
    expect(appendStatus(entry, 'interview', '2026-09-09', origin)).toBe(entry)
    expect(entry.statusHistory).toHaveLength(2)
    expect(completeNextAction(entry, '2026-09-09T14:00:00.000Z')).toMatchObject({ nextActionCompleted: true })
    expect(snoozeNextAction(entry, 3, '2026-09-10').nextActionDueDate).toBe('2026-09-13')
  })
})
