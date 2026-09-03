export type ApplicationType = 'quick' | 'targeted'

export type ApplicationOutcome =
  | 'assessment'
  | 'recruiter_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

export interface ApplicationEntry {
  id: string
  submittedAt: string
  quantity: number
  type: ApplicationType
  source?: string
  company?: string
  title?: string
  url?: string
  resumeVariant?: string
  notes?: string
  outcome?: ApplicationOutcome
  updatedAt: string
}

export interface AppSettings {
  weeklyTarget: number
  sources: string[]
  lastBackupAt: string | null
}

export interface EntryInput extends Omit<ApplicationEntry, 'id' | 'updatedAt'> {
  id?: string
  updatedAt?: string
}

export interface EntryDetails {
  type?: ApplicationType
  source?: string
  company?: string
  title?: string
  url?: string
  resumeVariant?: string
  notes?: string
  outcome?: ApplicationOutcome
}

export interface TrackerBackup {
  version: 1
  exportedAt: string
  entries: ApplicationEntry[]
  settings: AppSettings
}
