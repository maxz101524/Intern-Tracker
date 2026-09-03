import type { ApplicationEntry } from './types'

export interface WeekSummary {
  submitted: number
  quick: number
  targeted: number
  remaining: number
  expectedByNow: number
  requiredDailyPace: number
  isOnTrack: boolean
}

export interface DailyTotal {
  date: Date
  label: string
  total: number
  quick: number
  targeted: number
}

export interface WeeklyTotal {
  weekStart: Date
  label: string
  total: number
}

export function getWeekSummary(
  entries: ApplicationEntry[],
  weeklyTarget: number,
  now: Date,
): WeekSummary {
  const series = buildDailySeries(entries, now)
  const submitted = series.reduce((sum, day) => sum + day.total, 0)
  const quick = series.reduce((sum, day) => sum + day.quick, 0)
  const targeted = series.reduce((sum, day) => sum + day.targeted, 0)
  const safeTarget = Math.max(0, weeklyTarget)
  const remaining = Math.max(0, safeTarget - submitted)
  const elapsedDays = ((now.getDay() + 6) % 7) + 1
  const remainingDays = 8 - elapsedDays
  const expectedByNow = Math.ceil((safeTarget * elapsedDays) / 7)

  return {
    submitted,
    quick,
    targeted,
    remaining,
    expectedByNow,
    requiredDailyPace:
      remaining === 0 ? 0 : roundToOne(remaining / remainingDays),
    isOnTrack: submitted >= expectedByNow,
  }
}

export function buildDailySeries(
  entries: ApplicationEntry[],
  now: Date,
): DailyTotal[] {
  const weekStart = startOfMonday(now)
  const weekEnd = addDays(weekStart, 7)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index)
    return {
      date,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      total: 0,
      quick: 0,
      targeted: 0,
    }
  })

  for (const entry of entries) {
    const submittedAt = new Date(entry.submittedAt)
    if (submittedAt < weekStart || submittedAt >= weekEnd) continue
    const dayIndex = Math.floor(
      (localMidnight(submittedAt).getTime() - weekStart.getTime()) / 86_400_000,
    )
    const day = days[dayIndex]
    if (!day) continue
    day.total += entry.quantity
    day[entry.type] += entry.quantity
  }

  return days
}

export function startOfMonday(date: Date): Date {
  const start = localMidnight(date)
  const mondayOffset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - mondayOffset)
  return start
}

export function buildWeeklySeries(
  entries: ApplicationEntry[],
  now: Date,
): WeeklyTotal[] {
  const currentWeek = startOfMonday(now)
  return Array.from({ length: 8 }, (_, index) => {
    const weekStart = addDays(currentWeek, (index - 7) * 7)
    const weekEnd = addDays(weekStart, 7)
    const total = entries.reduce((sum, entry) => {
      const submittedAt = new Date(entry.submittedAt)
      return submittedAt >= weekStart && submittedAt < weekEnd
        ? sum + entry.quantity
        : sum
    }, 0)

    return {
      weekStart,
      label: weekStart.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      }),
      total,
    }
  })
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10
}
