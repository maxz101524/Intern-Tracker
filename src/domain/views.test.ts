import { describe, expect, it } from 'vitest'
import { createApplication } from './entries'
import { appendStatus } from './status'
import { EMPTY_FILTERS, filterApplications } from './views'

describe('application ledger views', () => {
  it('keeps rejection separate from progression while supporting exact pipeline filters', () => {
    let progressed = createApplication({ id: 'progressed', company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-01', effort: 'quick' })
    progressed = appendStatus(progressed, 'online_assessment', '2026-09-05')
    progressed = appendStatus(progressed, 'rejected', '2026-09-08')
    const rejected = appendStatus(createApplication({ id: 'rejected', company: 'Beta', title: 'DS Intern', submittedDate: '2026-09-02', effort: 'quick' }), 'rejected', '2026-09-06')
    const entries = [progressed, rejected]

    expect(filterApplications(entries, { ...EMPTY_FILTERS, metric: 'progressed' }, '2026-09-10').map(({ id }) => id)).toEqual(['progressed'])
    expect(filterApplications(entries, { ...EMPTY_FILTERS, metric: 'rejected' }, '2026-09-10')).toHaveLength(2)
    expect(filterApplications(entries, { ...EMPTY_FILTERS, status: 'online_assessment' }, '2026-09-10')).toEqual([])
  })
})
