import { describe, expect, it } from 'vitest'
import { createApplication } from './entries'
import { appendStatus } from './status'
import {
  buildDailySeries,
  buildWeeklySeries,
  getEffortPerformance,
  getOutcomeMetrics,
  getPipelineSummary,
  getSourcePerformance,
  getWeekSummary,
} from './analytics'
import type { ApplicationEffort } from './types'

function entry(id: string, submittedDate: string, effort: ApplicationEffort = 'quick', source?: string) {
  return createApplication({ id, company: `Company ${id}`, title: 'Intern', submittedDate, effort, source })
}

describe('singular application analytics', () => {
  it('counts one record per local Monday-through-Sunday week', () => {
    const entries = [
      entry('sun-before', '2026-08-30'),
      entry('monday', '2026-08-31', 'targeted'),
      entry('wednesday-1', '2026-09-02'),
      entry('wednesday-2', '2026-09-02'),
      entry('sunday', '2026-09-06', 'targeted'),
      entry('monday-after', '2026-09-07'),
    ]

    const summary = getWeekSummary(entries, 35, new Date(2026, 8, 2, 12))
    expect(summary).toMatchObject({ submitted: 4, quick: 2, targeted: 2, remaining: 31 })
    expect(buildDailySeries(entries, new Date(2026, 8, 2, 12)).map(({ total }) => total))
      .toEqual([1, 0, 2, 0, 0, 0, 1])
  })

  it('calculates proportional pace with today included among remaining days', () => {
    const entries = Array.from({ length: 7 }, (_, index) => entry(String(index), '2026-09-02'))
    const summary = getWeekSummary(entries, 35, new Date(2026, 8, 2, 12))

    expect(summary.expectedByNow).toBe(15)
    expect(summary.isOnTrack).toBe(false)
    expect(summary.requiredDailyPace).toBe(5.6)
  })

  it('builds an eight-week trend ending with the current week', () => {
    const entries = [
      entry('seven-weeks-ago', '2026-07-13'),
      entry('last-week', '2026-08-24'),
      entry('current-week-1', '2026-08-31'),
      entry('current-week-2', '2026-09-01'),
    ]
    expect(buildWeeklySeries(entries, new Date(2026, 8, 2, 12)).map(({ total }) => total))
      .toEqual([1, 0, 0, 0, 0, 0, 1, 2])
  })

  it('uses current display status for the pipeline including derived No response', () => {
    const oldApplied = entry('old', '2026-08-01')
    const rejected = appendStatus(entry('rejected', '2026-09-01'), 'rejected', '2026-09-03')

    expect(getPipelineSummary([oldApplied, rejected], '2026-09-04')).toMatchObject({
      no_response: 1,
      rejected: 1,
      applied: 0,
    })
  })

  it('retains historical responses and interviews after a later rejection', () => {
    let progressed = entry('progressed', '2026-08-01', 'targeted', 'Referral')
    progressed = appendStatus(progressed, 'online_assessment', '2026-08-05')
    progressed = appendStatus(progressed, 'interview', '2026-08-12')
    progressed = appendStatus(progressed, 'rejected', '2026-08-20')
    const waiting = entry('waiting', '2026-09-01', 'quick', 'LinkedIn')

    expect(getOutcomeMetrics([progressed, waiting], '2026-09-04')).toMatchObject({
      total: 2, responses: 1, interviews: 1, responseRate: 50, interviewRate: 50,
    })
    expect(getEffortPerformance([progressed, waiting])).toEqual([
      expect.objectContaining({ effort: 'quick', total: 1, responses: 0 }),
      expect.objectContaining({ effort: 'targeted', total: 1, responses: 1, interviews: 1 }),
    ])
    expect(getSourcePerformance([progressed, waiting])).toEqual([
      expect.objectContaining({ source: 'LinkedIn', total: 1 }),
      expect.objectContaining({ source: 'Referral', total: 1, responses: 1, interviews: 1 }),
    ])
  })
})
