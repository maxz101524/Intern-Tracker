import type { ApplicationColumn, AppSettings, SavedApplicationView } from './types'

export const DEFAULT_SOURCES = ['LinkedIn', 'Handshake', 'Company site', 'Simplify', 'Career fair', 'Referral']
export const DEFAULT_RESUME_VARIANTS = ['ML', 'DS', 'Hybrid', 'Applied AI', 'Tailored']
export const DEFAULT_APPLICATION_DAYS = [1, 2, 3, 4, 5]
export const DEFAULT_COLUMNS: ApplicationColumn[] = ['effort', 'source']

export function normalizeSettings(value?: Partial<AppSettings>): Required<AppSettings> {
  return {
    weeklyTarget: integer(value?.weeklyTarget, 0),
    sources: strings(value?.sources, DEFAULT_SOURCES),
    lastBackupAt: typeof value?.lastBackupAt === 'string' ? value.lastBackupAt : null,
    applicationDays: days(value?.applicationDays),
    resumeVariants: strings(value?.resumeVariants, DEFAULT_RESUME_VARIANTS),
    visibleColumns: columns(value?.visibleColumns),
    savedViews: savedViews(value?.savedViews),
    changeCount: integer(value?.changeCount, 0),
    lastBackupChangeCount: integer(value?.lastBackupChangeCount, 0),
  }
}

function integer(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : fallback
}

function strings(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? [...value] : [...fallback]
}

function days(value: unknown): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_APPLICATION_DAYS]
  const result = [...new Set(value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))]
  return result.length ? result : [...DEFAULT_APPLICATION_DAYS]
}

function columns(value: unknown): ApplicationColumn[] {
  const allowed: ApplicationColumn[] = ['source', 'effort', 'resumeVariant', 'nextAction', 'daysSinceUpdate']
  if (!Array.isArray(value)) return [...DEFAULT_COLUMNS]
  return [...new Set(value.filter((column): column is ApplicationColumn => allowed.includes(column as ApplicationColumn)))]
}

function savedViews(value: unknown): SavedApplicationView[] {
  if (!Array.isArray(value)) return []
  return value.filter((view): view is SavedApplicationView => {
    if (!view || typeof view !== 'object') return false
    const candidate = view as Partial<SavedApplicationView>
    return typeof candidate.id === 'string' && typeof candidate.name === 'string' && Boolean(candidate.filters)
  })
}
