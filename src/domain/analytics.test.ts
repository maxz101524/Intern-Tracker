import { describe, expect, it } from 'vitest'
import { buildDailySeries, buildWeeklySeries, getWeekSummary } from './analytics'
import type { ApplicationEntry } from './types'

const entry = (
  id: string,
  date: Date,
  quantity: number,
  type: 'quick' | 'targeted' = 'quick',
): ApplicationEntry => ({
  id,
  submittedAt: date.toISOString(),
  quantity,
  type,
  updatedAt: date.toISOString(),
})

describe('weekly analytics', () => {
  it('counts only the local Monday through Sunday containing the selected date', () => {
    const now = new Date(2026, 8, 2, 12)
    const entries = [
      entry('sun-before', new Date(2026, 7, 30, 12), 20),
      entry('monday', new Date(2026, 7, 31, 9), 2, 'targeted'),
      entry('wednesday', new Date(2026, 8, 2, 10), 5),
      entry('sunday', new Date(2026, 8, 6, 18), 3, 'targeted'),
      entry('monday-after', new Date(2026, 8, 7, 9), 20),
    ]

    const summary = getWeekSummary(entries, 35, now)

    expect(summary.submitted).toBe(10)
    expect(summary.quick).toBe(5)
    expect(summary.targeted).toBe(5)
    expect(summary.remaining).toBe(25)
  })

  it('calculates proportional pace and includes today among the remaining days', () => {
    const now = new Date(2026, 8, 2, 12)
    const entries = [entry('batch', new Date(2026, 8, 2, 10), 7)]

    const summary = getWeekSummary(entries, 35, now)

    expect(summary.expectedByNow).toBe(15)
    expect(summary.isOnTrack).toBe(false)
    expect(summary.requiredDailyPace).toBe(5.6)
  })

  it('returns a seven-day series with zeroes for days without applications', () => {
    const now = new Date(2026, 8, 2, 12)
    const entries = [
      entry('monday', new Date(2026, 7, 31, 9), 2),
      entry('wednesday', new Date(2026, 8, 2, 10), 4),
    ]

    expect(buildDailySeries(entries, now).map(({ total }) => total)).toEqual([
      2, 0, 4, 0, 0, 0, 0,
    ])
  })

  it('builds an eight-week trend ending with the current week', () => {
    const now = new Date(2026, 8, 2, 12)
    const entries = [
      entry('seven-weeks-ago', new Date(2026, 6, 13, 9), 9),
      entry('last-week', new Date(2026, 7, 24, 9), 3),
      entry('current-week', new Date(2026, 7, 31, 9), 5),
    ]

    const series = buildWeeklySeries(entries, now)

    expect(series).toHaveLength(8)
    expect(series.map(({ total }) => total)).toEqual([9, 0, 0, 0, 0, 0, 3, 5])
  })
})
