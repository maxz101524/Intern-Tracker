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
export interface GmailApplicationMatch { entryId: string; score: number }

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
  if (input?.detectorVersion !== undefined) {
    if (!Number.isInteger(input.detectorVersion) || input.detectorVersion < 1) throw new Error('Gmail detector version is not valid.')
    state.detectorVersion = input.detectorVersion
  }
  return state
}

export function findPossibleDuplicate(
  candidate: Pick<GmailCandidate, 'company' | 'title' | 'submittedDate'>,
  entries: Array<Pick<ApplicationEntry, 'id' | 'company' | 'title' | 'submittedDate'>>,
): PossibleDuplicate | null {
  const matches = entries.flatMap((entry) => {
    const days = Math.abs(dayNumber(entry.submittedDate) - dayNumber(candidate.submittedDate))
    const company = companySimilarity(candidate.company, entry.company)
    const title = titleSimilarity(candidate.title, entry.title)
    const score = company * .57 + title * .43
    return days <= 14 && company >= .86 && title >= .76 && score >= .83
      ? [{ entry, days, score }]
      : []
  }).sort((a, b) => b.score - a.score || a.days - b.days)
  const best = matches[0]
  if (!best) return null
  const exact = best.days === 0 && normalizeCompany(best.entry.company) === normalizeCompany(candidate.company) &&
    normalizeTitle(best.entry.title) === normalizeTitle(candidate.title)
  return { kind: exact ? 'exact' : 'near', entryId: best.entry.id }
}

export function rankGmailApplicationMatches(
  candidate: Pick<GmailCandidate, 'company' | 'title' | 'sender'>,
  entries: ApplicationEntry[],
): GmailApplicationMatch[] {
  const senderCompany = senderDomainRoot(candidate.sender)
  return entries.map((entry) => {
    const company = Math.max(
      companySimilarity(candidate.company, entry.company),
      senderCompany ? companySimilarity(senderCompany, entry.company) * .9 : 0,
    )
    const title = isGenericTitle(candidate.title) ? .45 : titleSimilarity(candidate.title, entry.title)
    const score = company * .64 + title * .36
    return { entryId: entry.id, score }
  }).sort((a, b) => b.score - a.score)
}

export function matchGmailStatusToApplications(
  candidate: Pick<GmailCandidate, 'company' | 'title' | 'sender'>,
  entries: ApplicationEntry[],
): string[] {
  const active = entries.filter((entry) => !['rejected', 'withdrawn'].includes(getCurrentStatus(entry)))
  const ranked = rankGmailApplicationMatches(candidate, active)
  const strong = ranked.filter((match) => match.score >= .72)
  if (strong.length === 1 || (strong.length > 1 && strong[0].score - strong[1].score >= .16)) return [strong[0].entryId]
  if (strong.length) return strong.slice(0, 6).map((match) => match.entryId)

  const sameCompany = active.filter((entry) => companySimilarity(candidate.company, entry.company) >= .9)
  return sameCompany.length === 1 ? [sameCompany[0].id] : []
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

function companySimilarity(left: string, right: string): number {
  const a = normalizeCompany(left)
  const b = normalizeCompany(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 4) return .93
  return tokenSimilarity(companyTokens(left), companyTokens(right))
}

function titleSimilarity(left: string, right: string): number {
  const a = normalizeTitle(left)
  const b = normalizeTitle(right)
  if (!a || !b) return 0
  if (a === b) return 1
  return tokenSimilarity(titleTokens(left), titleTokens(right))
}

function normalizeCompany(value: string): string {
  return companyTokens(value).join('')
}

function normalizeTitle(value: string): string {
  return titleTokens(value).join('')
}

function companyTokens(value: string): string[] {
  const ignored = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'company', 'co', 'plc', 'holdings'])
  return rawTokens(value).filter((token) => !ignored.has(token))
}

function titleTokens(value: string): string[] {
  const ignored = new Set(['job', 'role', 'position', 'summer', 'fall', 'spring', '2025', '2026', '2027', '2028', 'internship', 'intern'])
  return rawTokens(value).map((token) => ({
    engineering: 'engineer', engineered: 'engineer', sciences: 'science', analytical: 'analytics',
    artificial: 'ai', intelligence: 'ai', machine: 'ml', learning: 'ml',
  })[token] ?? token).filter((token) => !ignored.has(token))
}

function rawTokens(value: string): string[] {
  return value.toLowerCase().replace(/['’]s\b/g, 's').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

function tokenSimilarity(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0
  const a = new Set(left)
  const b = new Set(right)
  const intersection = [...a].filter((token) => b.has(token)).length
  return (2 * intersection) / (a.size + b.size)
}

function isGenericTitle(value: string): boolean {
  return /^(?:application )?(?:status )?update$/i.test(value.trim())
}

function senderDomainRoot(sender: string): string | null {
  const domain = sender.match(/@([a-z0-9.-]+)>?/i)?.[1]
  if (!domain) return null
  const root = domain.split('.').at(-2)
  return root && !/^(?:workday|greenhouse|lever|ashbyhq|smartrecruiters|icims|ripplematch|oraclecloud)$/.test(root)
    ? root
    : null
}

function dayNumber(value: string): number {
  if (!isValidDateOnly(value)) return Number.POSITIVE_INFINITY
  const [year, month, day] = value.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}
