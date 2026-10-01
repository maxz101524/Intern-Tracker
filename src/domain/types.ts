import type { MuseEntryPayload, MuseStatusPayload } from '../../shared/museContract'

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
  origin?: ApplicationOrigin
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
  nextAction?: string
  nextActionDueDate?: string
  nextActionCompleted?: boolean
  nextActionCompletedAt?: string
  jobDescriptionExcerpt?: string
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
  applicationDays?: number[]
  resumeVariants?: string[]
  visibleColumns?: ApplicationColumn[]
  savedViews?: SavedApplicationView[]
  changeCount?: number
  lastBackupChangeCount?: number
}

export type ApplicationColumn = 'source' | 'effort' | 'resumeVariant' | 'nextAction' | 'daysSinceUpdate'

export type ApplicationViewMetric = 'any_response' | 'progressed' | 'rejected' | 'awaiting_response' | 'in_progress'

export interface ApplicationFilterState {
  query: string
  status: DisplayStatus | 'all'
  effort: ApplicationEffort | 'all'
  source: string
  fromDate: string
  toDate: string
  metric?: ApplicationViewMetric
  preset?: 'in_progress' | 'this_week' | 'awaiting_response'
}

export interface SavedApplicationView {
  id: string
  name: string
  filters: ApplicationFilterState
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
  kind?: 'application' | 'status'
  suggestedStatus?: ApplicationStatus
  eventDate?: string
  matchedEntryIds?: string[]
  supportingSnippet?: string
  linkedEntryId?: string
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
  detectorVersion?: number
}

export interface GmailImportData {
  candidates: GmailCandidate[]
  processedMessages: ProcessedGmailMessage[]
  syncState: GmailSyncState
}

export type MuseItemState = 'applied' | 'pending' | 'dismissed' | 'skipped'

export type MuseReviewReason =
  | 'invalid'
  | 'possible_duplicate'
  | 'unmatched'
  | 'low_confidence'
  | 'closed_application'
  | 'undone'

export type MuseFillField = 'url' | 'source' | 'resumeVariant' | 'notes' | 'origin'

interface MuseItemBase {
  key: string
  batchId: string
  streamId: string
  state: MuseItemState
  reason?: MuseReviewReason
  detail?: string
  suggestedEntryIds?: string[]
  receivedAt: string
  reviewedAt?: string
}

export interface MuseEntryItem extends MuseItemBase {
  kind: 'entry'
  payload: MuseEntryPayload
  result?: { entryId: string; action: 'created' | 'filled'; filledFields?: MuseFillField[] }
}

export interface MuseStatusItem extends MuseItemBase {
  kind: 'status'
  payload: MuseStatusPayload
  result?: { entryId: string; action: 'status_added' }
}

export type MuseItem = MuseEntryItem | MuseStatusItem

export interface MuseSyncState {
  key: 'muse'
  cursor?: string
  lastPulledAt?: string
  lastLedgerHash?: string
  lastLedgerPublishedAt?: string
  retentionGap?: boolean
}

export interface MuseData {
  items: MuseItem[]
  syncState: MuseSyncState
}

export interface TrackerBackup {
  version: 4
  exportedAt: string
  entries: ApplicationEntry[]
  settings: AppSettings
  gmail: GmailImportData
  muse?: MuseData
}
