import { describe, expect, it } from 'vitest'
import { createApplication } from './entries'

describe('singular application rules', () => {
  it('creates one named application with an initial Applied event', () => {
    const entry = createApplication({
      company: ' Cigna ',
      title: ' AI Innovation Intern ',
      submittedDate: '2026-09-03',
      effort: 'targeted',
      source: ' Career fair ',
    })

    expect(entry).toMatchObject({
      company: 'Cigna',
      title: 'AI Innovation Intern',
      submittedDate: '2026-09-03',
      effort: 'targeted',
      source: 'Career fair',
    })
    expect(entry.statusHistory).toEqual([
      expect.objectContaining({ status: 'applied', date: '2026-09-03' }),
    ])
  })

  it('requires company and role title', () => {
    expect(() => createApplication({
      company: ' ', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick',
    })).toThrow('Company is required.')

    expect(() => createApplication({
      company: 'Verisk', title: '', submittedDate: '2026-09-03', effort: 'quick',
    })).toThrow('Role title is required.')
  })

  it('rejects impossible calendar dates and invalid effort values', () => {
    expect(() => createApplication({
      company: 'Verisk', title: 'AI Intern', submittedDate: '2026-02-30', effort: 'quick',
    })).toThrow('Submission date is not valid.')

    expect(() => createApplication({
      company: 'Verisk', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'high' as 'quick',
    })).toThrow('Application effort is not valid.')
  })

  it('preserves identity and status history while cleaning edited details', () => {
    const original = createApplication({
      company: 'Verisk', title: 'AI Intern', submittedDate: '2026-09-01', effort: 'quick',
    })
    const edited = createApplication({
      ...original,
      company: ' Verisk Analytics ',
      notes: '  Met recruiter  ',
    })

    expect(edited.id).toBe(original.id)
    expect(edited.statusHistory).toEqual(original.statusHistory)
    expect(edited.company).toBe('Verisk Analytics')
    expect(edited.notes).toBe('Met recruiter')
  })
})
