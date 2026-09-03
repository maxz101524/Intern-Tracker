import { describe, expect, it } from 'vitest'
import { createEntry, splitBatchEntry } from './entries'

describe('entry rules', () => {
  it('rejects a batch that pretends to describe one named role', () => {
    expect(() =>
      createEntry({
        submittedAt: '2026-09-03T12:00:00.000Z',
        quantity: 5,
        type: 'quick',
        company: 'Acme',
      }),
    ).toThrow('Batch entries cannot include role details or outcomes.')
  })

  it('rejects zero and fractional quantities', () => {
    expect(() =>
      createEntry({
        submittedAt: '2026-09-03T12:00:00.000Z',
        quantity: 0,
        type: 'quick',
      }),
    ).toThrow('Quantity must be a positive whole number.')

    expect(() =>
      createEntry({
        submittedAt: '2026-09-03T12:00:00.000Z',
        quantity: 1.5,
        type: 'quick',
      }),
    ).toThrow('Quantity must be a positive whole number.')
  })

  it('splits one detailed application from a batch without changing the total', () => {
    const batch = createEntry({
      submittedAt: '2026-09-01T14:00:00.000Z',
      quantity: 4,
      type: 'quick',
      source: 'LinkedIn',
    })

    const result = splitBatchEntry(batch, {
      company: 'Acme',
      title: 'Data Science Intern',
      type: 'targeted',
    })

    expect(result.remainingBatch?.quantity).toBe(3)
    expect(result.detailedEntry.quantity).toBe(1)
    expect(result.detailedEntry.company).toBe('Acme')
    expect(result.detailedEntry.submittedAt).toBe(batch.submittedAt)
    expect(
      (result.remainingBatch?.quantity ?? 0) + result.detailedEntry.quantity,
    ).toBe(4)
  })

  it('removes the batch when its only application is promoted', () => {
    const single = createEntry({
      submittedAt: '2026-09-01T14:00:00.000Z',
      quantity: 1,
      type: 'quick',
    })

    const result = splitBatchEntry(single, { company: 'Acme' })

    expect(result.remainingBatch).toBeNull()
    expect(result.detailedEntry.company).toBe('Acme')
  })
})
