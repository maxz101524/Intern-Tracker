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

export interface ApplicationOrigin {
  provider: 'gmail'
  messageId: string
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
  origin?: ApplicationOrigin
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

export type GmailCandidateState = 'pending' | 'imported' | 'dismissed'

export interface GmailCandidate {
  messageId: string
  threadId: string
  receivedAt: string
  submittedDate: string
  sender: string
  subject: string
  company: string
  title: string
  confidence: 'high' | 'medium'
  matchedRule: string
  state: GmailCandidateState
  createdAt: string
  reviewedAt?: string
}

export interface ProcessedGmailMessage {
  messageId: string
  disposition: 'candidate' | 'ignored' | 'imported' | 'dismissed' | 'error'
  processedAt: string
}

export interface GmailSyncState {
  key: 'gmail'
  accountEmail?: string
  historyId?: string
  lastSuccessfulSyncAt?: string
  initialSyncCompleted: boolean
}

export interface GmailImportData {
  candidates: GmailCandidate[]
  processedMessages: ProcessedGmailMessage[]
  syncState: GmailSyncState
}

export interface TrackerBackup {
  version: 3
  exportedAt: string
  entries: ApplicationEntry[]
  settings: AppSettings
  gmail: GmailImportData
}
