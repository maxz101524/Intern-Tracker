import { getDisplayStatus, parseLocalDate, todayDate } from './status'
import type { ApplicationEffort, ApplicationEntry, DisplayStatus } from './types'

export interface WeekSummary {
  submitted: number
  quick: number
  targeted: number
  remaining: number
  expectedByNow: number
  requiredDailyPace: number
  isOnTrack: boolean
}

export interface DailyTotal { date: Date; label: string; total: number; quick: number; targeted: number }
export interface WeeklyTotal { weekStart: Date; label: string; total: number }
export type PipelineSummary = Record<DisplayStatus, number>

export interface OutcomeMetrics {
  total: number
  active: number
  awaitingResponse: number
  inProgress: number
  anyResponse: number
  progressed: number
  rejected: number
  responses: number
  interviews: number
  offers: number
  anyResponseRate: number
  progressedRate: number
  rejectedRate: number
  responseRate: number
  interviewRate: number
}

export interface PerformanceRow {
  total: number
  responses: number
  progressed: number
  rejected: number
  interviews: number
  responseRate: number
  progressedRate: number
  rejectedRate: number
  interviewRate: number
}

export interface EffortPerformance extends PerformanceRow { effort: ApplicationEffort }
export interface SourcePerformance extends PerformanceRow { source: string }

export function getWeekSummary(
  entries: ApplicationEntry[],
  weeklyTarget: number,
  now: Date,
  applicationDays: number[] = [1, 2, 3, 4, 5, 6, 0],
): WeekSummary {
  const series = buildDailySeries(entries, now)
  const submitted = sum(series.map((day) => day.total))
  const quick = sum(series.map((day) => day.quick))
  const targeted = sum(series.map((day) => day.targeted))
  const target = Math.max(0, weeklyTarget)
  const remaining = Math.max(0, target - submitted)
  const scheduledDays = [...new Set(applicationDays)].filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  const effectiveDays = scheduledDays.length ? scheduledDays : [1, 2, 3, 4, 5, 6, 0]
  const week = Array.from({ length: 7 }, (_, index) => addDays(startOfMonday(now), index))
  const elapsedDays = week.filter((date) => effectiveDays.includes(date.getDay()) && date <= now).length
  const remainingDays = week.filter((date) => effectiveDays.includes(date.getDay()) && date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())).length
  const expectedByNow = Math.ceil((target * elapsedDays) / effectiveDays.length)
  return {
    submitted,
    quick,
    targeted,
    remaining,
    expectedByNow,
    requiredDailyPace: remaining === 0 ? 0 : roundToOne(remaining / Math.max(1, remainingDays)),
    isOnTrack: submitted >= expectedByNow,
  }
}

export function buildDailySeries(entries: ApplicationEntry[], now: Date): DailyTotal[] {
  const weekStart = startOfMonday(now)
  const dates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  return dates.map((date) => {
    const key = dateOnly(date)
    const matching = entries.filter((entry) => entry.submittedDate === key)
    return {
      date,
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      total: matching.length,
      quick: matching.filter((entry) => entry.effort === 'quick').length,
      targeted: matching.filter((entry) => entry.effort === 'targeted').length,
    }
  })
}

export function startOfMonday(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  return start
}

export function buildWeeklySeries(entries: ApplicationEntry[], now: Date): WeeklyTotal[] {
  const currentWeek = startOfMonday(now)
  return Array.from({ length: 8 }, (_, index) => {
    const weekStart = addDays(currentWeek, (index - 7) * 7)
    const weekEnd = addDays(weekStart, 7)
    const startKey = dateOnly(weekStart)
    const endKey = dateOnly(weekEnd)
    return {
      weekStart,
      label: weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      total: entries.filter((entry) => entry.submittedDate >= startKey && entry.submittedDate < endKey).length,
    }
  })
}

export function getPipelineSummary(entries: ApplicationEntry[], today = todayDate()): PipelineSummary {
  const summary: PipelineSummary = {
    applied: 0,
    no_response: 0,
    online_assessment: 0,
    recruiter_screen: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
  }
  for (const entry of entries) summary[getDisplayStatus(entry, today)] += 1
  return summary
}

export function getOutcomeMetrics(entries: ApplicationEntry[], today = todayDate()): OutcomeMetrics {
  const total = entries.length
  const anyResponse = entries.filter(hasResponse).length
  const progressed = entries.filter(hasProgressed).length
  const rejected = entries.filter((entry) => getDisplayStatus(entry, today) === 'rejected').length
  const interviews = entries.filter(hasInterview).length
  const offers = entries.filter((entry) => entry.statusHistory.some(({ status }) => status === 'offer')).length
  const awaitingStatuses: DisplayStatus[] = ['applied', 'no_response']
  const progressStatuses: DisplayStatus[] = ['online_assessment', 'recruiter_screen', 'interview']
  const awaitingResponse = entries.filter((entry) => awaitingStatuses.includes(getDisplayStatus(entry, today))).length
  const inProgress = entries.filter((entry) => progressStatuses.includes(getDisplayStatus(entry, today))).length
  const active = awaitingResponse + inProgress
  return {
    total,
    active,
    awaitingResponse,
    inProgress,
    anyResponse,
    progressed,
    rejected,
    responses: anyResponse,
    interviews,
    offers,
    anyResponseRate: percent(anyResponse, total),
    progressedRate: percent(progressed, total),
    rejectedRate: percent(rejected, total),
    responseRate: percent(anyResponse, total),
    interviewRate: percent(interviews, total),
  }
}

export function getEffortPerformance(entries: ApplicationEntry[]): EffortPerformance[] {
  return (['quick', 'targeted'] as ApplicationEffort[]).map((effort) => ({
    effort,
    ...performance(entries.filter((entry) => entry.effort === effort)),
  }))
}

export function getSourcePerformance(entries: ApplicationEntry[]): SourcePerformance[] {
  const sources = [...new Set(entries.map((entry) => entry.source ?? 'Not specified'))].sort()
  return sources.map((source) => ({
    source,
    ...performance(entries.filter((entry) => (entry.source ?? 'Not specified') === source)),
  }))
}

export function formatShortDate(value: string): string {
  return parseLocalDate(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function performance(entries: ApplicationEntry[]): PerformanceRow {
  const total = entries.length
  const responses = entries.filter(hasResponse).length
  const progressed = entries.filter(hasProgressed).length
  const rejected = entries.filter((entry) => getDisplayStatus(entry) === 'rejected').length
  const interviews = entries.filter(hasInterview).length
  return {
    total,
    responses,
    progressed,
    rejected,
    interviews,
    responseRate: percent(responses, total),
    progressedRate: percent(progressed, total),
    rejectedRate: percent(rejected, total),
    interviewRate: percent(interviews, total),
  }
}

function hasResponse(entry: ApplicationEntry): boolean {
  return entry.statusHistory.some(({ status }) => status !== 'applied' && status !== 'withdrawn')
}

function hasProgressed(entry: ApplicationEntry): boolean {
  return entry.statusHistory.some(({ status }) =>
    status === 'online_assessment' || status === 'recruiter_screen' || status === 'interview' || status === 'offer',
  )
}

function hasInterview(entry: ApplicationEntry): boolean {
  return entry.statusHistory.some(({ status }) => status === 'interview' || status === 'offer')
}

function dateOnly(date: Date): string {
  return todayDate(date)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function percent(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 100)
}

function roundToOne(value: number): number {
  return Math.round(value * 10) / 10
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
