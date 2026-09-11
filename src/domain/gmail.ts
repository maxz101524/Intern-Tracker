import { getCurrentStatus, isApplicationStatus, isValidDateOnly } from './status'
import type {
  ApplicationEntry,
  GmailCandidate,
  GmailCandidateState,
  GmailImportData,
  GmailSyncState,
  ProcessedGmailMessage,
} from './types'

export interface GmailCandidateInput extends Omit<GmailCandidate, 'state' | 'createdAt'> {
  state?: GmailCandidateState
  createdAt?: string
}

export type PossibleDuplicate = { kind: 'exact' | 'near'; entryId: string }

export function emptyGmailImportData(): GmailImportData {
  return {
    candidates: [],
    processedMessages: [],
    syncState: { key: 'gmail', initialSyncCompleted: false },
  }
}

export function createGmailCandidate(input: GmailCandidateInput): GmailCandidate {
  const state = input.state ?? 'pending'
  if (!['pending', 'imported', 'dismissed'].includes(state)) {
    throw new Error('Gmail candidate state is not valid.')
  }
  if (input.confidence !== 'high' && input.confidence !== 'medium') {
    throw new Error('Gmail confidence is not valid.')
  }
  if (!isValidDateOnly(input.submittedDate)) {
    throw new Error('Gmail submission date is not valid.')
  }

  const candidate: GmailCandidate = {
    messageId: required(input.messageId, 'Gmail message ID is required.'),
    threadId: required(input.threadId, 'Gmail thread ID is required.'),
    receivedAt: iso(input.receivedAt, 'Gmail receipt time is not valid.'),
    submittedDate: input.submittedDate,
    sender: required(input.sender, 'Gmail sender is required.'),
    subject: required(input.subject, 'Gmail subject is required.'),
    company: required(input.company, 'Gmail company is required.'),
    title: required(input.title, 'Gmail role title is required.'),
    confidence: input.confidence,
    matchedRule: required(input.matchedRule, 'Gmail match rule is required.'),
    state,
    createdAt: iso(input.createdAt ?? new Date().toISOString(), 'Gmail candidate creation time is not valid.'),
  }
  if (input.kind === 'status') {
    candidate.kind = 'status'
    if (!isApplicationStatus(input.suggestedStatus) || !isValidDateOnly(input.eventDate)) {
      throw new Error('Gmail status suggestion is not valid.')
    }
    candidate.suggestedStatus = input.suggestedStatus
    candidate.eventDate = input.eventDate
    candidate.matchedEntryIds = Array.isArray(input.matchedEntryIds)
      ? input.matchedEntryIds.filter((id): id is string => typeof id === 'string' && Boolean(id))
      : []
  }
  if (input.supportingSnippet) candidate.supportingSnippet = input.supportingSnippet.trim()
  if (input.linkedEntryId) candidate.linkedEntryId = input.linkedEntryId.trim()
  if (input.reviewedAt !== undefined) {
    candidate.reviewedAt = iso(input.reviewedAt, 'Gmail review time is not valid.')
  }
  return candidate
}

export function createProcessedGmailMessage(input: ProcessedGmailMessage): ProcessedGmailMessage {
  if (!['candidate', 'ignored', 'imported', 'dismissed', 'error'].includes(input.disposition)) {
    throw new Error('Gmail message disposition is not valid.')
  }
  return {
    messageId: required(input.messageId, 'Gmail message ID is required.'),
    disposition: input.disposition,
    processedAt: iso(input.processedAt, 'Gmail processing time is not valid.'),
  }
}

export function createGmailSyncState(input?: Partial<GmailSyncState>): GmailSyncState {
  if (input?.key !== undefined && input.key !== 'gmail') throw new Error('Gmail sync key is not valid.')
  const state: GmailSyncState = {
    key: 'gmail',
    initialSyncCompleted: input?.initialSyncCompleted ?? false,
  }
  if (typeof state.initialSyncCompleted !== 'boolean') throw new Error('Gmail sync state is not valid.')
  if (input?.accountEmail !== undefined) state.accountEmail = required(input.accountEmail, 'Gmail account is not valid.')
  if (input?.historyId !== undefined) state.historyId = required(input.historyId, 'Gmail history ID is not valid.')
  if (input?.lastSuccessfulSyncAt !== undefined) {
    state.lastSuccessfulSyncAt = iso(input.lastSuccessfulSyncAt, 'Gmail sync time is not valid.')
  }
  return state
}

export function findPossibleDuplicate(
  candidate: Pick<GmailCandidate, 'company' | 'title' | 'submittedDate'>,
  entries: ApplicationEntry[],
): PossibleDuplicate | null {
  const company = normalize(candidate.company)
  const title = normalize(candidate.title)
  for (const entry of entries) {
    if (normalize(entry.company) !== company || normalize(entry.title) !== title) continue
    const distance = Math.abs(dayNumber(entry.submittedDate) - dayNumber(candidate.submittedDate))
    if (distance === 0) return { kind: 'exact', entryId: entry.id }
    if (distance <= 3) return { kind: 'near', entryId: entry.id }
  }
  return null
}

export function matchGmailStatusToApplications(
  candidate: Pick<GmailCandidate, 'company' | 'title' | 'sender'>,
  entries: ApplicationEntry[],
): string[] {
  const company = normalize(candidate.company)
  const title = normalize(candidate.title)
  const active = entries.filter((entry) => !['rejected', 'withdrawn'].includes(getCurrentStatus(entry)))
  const exact = active.filter((entry) => normalize(entry.company) === company && title && normalize(entry.title) === title)
  if (exact.length) return exact.map((entry) => entry.id)
  const sameCompany = active.filter((entry) => normalize(entry.company) === company)
  if (sameCompany.length) return sameCompany.map((entry) => entry.id)
  const senderDomain = candidate.sender.match(/@([a-z0-9.-]+)>?/i)?.[1]?.split('.').at(-2)
  if (!senderDomain) return []
  return active.filter((entry) => normalize(entry.company).includes(normalize(senderDomain))).map((entry) => entry.id)
}

function required(value: string, message: string): string {
  const result = value?.trim()
  if (!result) throw new Error(message)
  return result
}

function iso(value: string, message: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) throw new Error(message)
  return new Date(time).toISOString()
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function dayNumber(value: string): number {
  if (!isValidDateOnly(value)) return Number.POSITIVE_INFINITY
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}
