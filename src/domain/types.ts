export type ApplicationEffort = 'quick' | 'targeted'

export type ApplicationStatus =
  | 'applied'
  | 'online_assessment'
  | 'recruiter_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

export type DisplayStatus = ApplicationStatus | 'no_response'

export interface StatusEvent {
  id: string
  status: ApplicationStatus
  date: string
}

export interface ApplicationEntry {
  id: string
  company: string
  title: string
  submittedDate: string
  effort: ApplicationEffort
  source?: string
  url?: string
  resumeVariant?: string
  notes?: string
  statusHistory: StatusEvent[]
  updatedAt: string
}

export interface ApplicationInput extends Omit<ApplicationEntry, 'id' | 'updatedAt' | 'statusHistory'> {
  id?: string
  updatedAt?: string
  statusHistory?: StatusEvent[]
}

export interface AppSettings {
  weeklyTarget: number
  sources: string[]
  lastBackupAt: string | null
}

export interface TrackerBackup {
  version: 2
  exportedAt: string
  entries: ApplicationEntry[]
  settings: AppSettings
}
