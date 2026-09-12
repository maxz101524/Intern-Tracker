import { createGmailCandidate, createProcessedGmailMessage, findPossibleDuplicate, matchGmailStatusToApplications } from '../domain/gmail'
import type { GmailSyncState } from '../domain/types'
import type { TrackerRepository } from '../storage/repository'
import { GmailApiError, type GmailApiClient } from './api'
import { detectApplicationConfirmation, detectApplicationStatusUpdate } from './detector'
import { normalizeGmailMessage } from './message'

const INITIAL_DAYS = 30
const RECOVERY_DAYS = 2
const DAY_MS = 86_400_000
const MESSAGE_CONCURRENCY = 5
const DETECTOR_VERSION = 2

export type GmailSyncMode = 'initial' | 'incremental' | 'recovery'

export interface GmailSyncResult {
  newCandidates: number
  inspectedMessages: number
  mode: GmailSyncMode
  syncedAt: string
}

export async function syncGmail({
  api,
  repository,
  now = new Date(),
}: {
  api: GmailApiClient
  repository: TrackerRepository
  now?: Date
}): Promise<GmailSyncResult> {
  const syncedAt = now.toISOString()
  const [profile, previous, processed, candidates, entries] = await Promise.all([
    api.getProfile(),
    repository.getGmailSyncState(),
    repository.listProcessedGmailMessages(),
    repository.listGmailCandidates(),
    repository.listEntries(),
  ])

  if (previous.accountEmail && previous.accountEmail.toLowerCase() !== profile.emailAddress.toLowerCase()) {
    throw new Error('Reconnect the Gmail account previously used by Paceboard.')
  }

  let mode: GmailSyncMode
  let messageIds: string[]
  let historyId: string
  if (!previous.initialSyncCompleted || !previous.historyId) {
    mode = 'initial'
    messageIds = await api.listInitialMessageIds(epochSeconds(now.getTime() - INITIAL_DAYS * DAY_MS))
    historyId = profile.historyId
  } else {
    try {
      const history = await api.listHistoryMessageIds(previous.historyId)
      mode = 'incremental'
      messageIds = history.messageIds
      historyId = history.historyId
    } catch (caught) {
      if (!(caught instanceof GmailApiError) || caught.code !== 'history-expired') throw caught
      mode = 'recovery'
      const recoveryStart = previous.lastSuccessfulSyncAt
        ? Date.parse(previous.lastSuccessfulSyncAt) - RECOVERY_DAYS * DAY_MS
        : now.getTime() - INITIAL_DAYS * DAY_MS
      messageIds = await api.listInitialMessageIds(epochSeconds(recoveryStart))
      historyId = profile.historyId
    }
  }

  const refreshCandidateIds = (previous.detectorVersion ?? 1) < DETECTOR_VERSION
    ? new Set(candidates.filter((candidate) => candidate.state === 'pending').map((candidate) => candidate.messageId))
    : new Set<string>()
  const knownIds = new Set([
    ...processed.filter((message) => message.disposition !== 'error').map((message) => message.messageId),
    ...candidates.map((candidate) => candidate.messageId),
    ...entries.flatMap((entry) => entry.origin?.provider === 'gmail' ? [entry.origin.messageId] : []),
    ...entries.flatMap((entry) => entry.statusHistory.flatMap((event) =>
      event.origin?.provider === 'gmail' ? [event.origin.messageId] : [],
    )),
  ])
  for (const messageId of refreshCandidateIds) knownIds.delete(messageId)
  const retryIds = processed.filter((message) => message.disposition === 'error').map((message) => message.messageId)
  const pendingIds = [...new Set([...messageIds, ...retryIds, ...refreshCandidateIds])].filter((id) => !knownIds.has(id))
  const outcomes = await mapWithConcurrency(pendingIds, MESSAGE_CONCURRENCY, async (messageId) => {
    const raw = await api.getMessage(messageId)
    try {
      const message = normalizeGmailMessage(raw)
      const statusUpdate = detectApplicationStatusUpdate(message)
      const confirmation = statusUpdate ? null : detectApplicationConfirmation(message)
      if (!statusUpdate && !confirmation) {
        return {
          processed: createProcessedGmailMessage({ messageId, disposition: 'ignored', processedAt: syncedAt }),
        }
      }
      const detected = statusUpdate ?? confirmation!
      const base = {
        messageId: message.id,
        threadId: message.threadId,
        receivedAt: message.receivedAt,
        submittedDate: localDate(message.receivedAt),
        sender: message.from,
        subject: message.subject,
        company: detected.company,
        title: detected.title,
        confidence: detected.confidence,
        matchedRule: detected.matchedRule,
        createdAt: syncedAt,
      }
      if (!statusUpdate && findPossibleDuplicate({
        company: detected.company,
        title: detected.title,
        submittedDate: localDate(message.receivedAt),
      }, entries)?.kind === 'exact') {
        return {
          processed: createProcessedGmailMessage({ messageId, disposition: 'ignored', processedAt: syncedAt }),
        }
      }
      const candidate = statusUpdate
        ? createGmailCandidate({
          ...base,
          kind: 'status',
          suggestedStatus: statusUpdate.suggestedStatus,
          eventDate: localDate(message.receivedAt),
          supportingSnippet: statusUpdate.supportingSnippet,
          matchedEntryIds: matchGmailStatusToApplications({
            company: statusUpdate.company,
            title: statusUpdate.title,
            sender: message.from,
          }, entries),
        })
        : createGmailCandidate(base)
      return {
        candidate,
        processed: createProcessedGmailMessage({ messageId, disposition: 'candidate', processedAt: syncedAt }),
      }
    } catch {
      return {
        processed: createProcessedGmailMessage({ messageId, disposition: 'error', processedAt: syncedAt }),
      }
    }
  })

  const nextState: GmailSyncState = {
    key: 'gmail',
    accountEmail: profile.emailAddress,
    historyId,
    lastSuccessfulSyncAt: syncedAt,
    initialSyncCompleted: true,
    detectorVersion: DETECTOR_VERSION,
  }
  const existingReviewApplications = candidates
    .filter((candidate) => candidate.state === 'pending' && candidate.kind !== 'status' && !refreshCandidateIds.has(candidate.messageId))
    .map((candidate) => ({ id: candidate.messageId, company: candidate.company, title: candidate.title, submittedDate: candidate.submittedDate }))
  const newCandidates: ReturnType<typeof createGmailCandidate>[] = []
  const processedMessages = outcomes.map((outcome) => {
    if (!outcome.candidate) return outcome.processed
    if (outcome.candidate.kind !== 'status') {
      const proposedThisSync = newCandidates
        .filter((candidate) => candidate.kind !== 'status')
        .map((candidate) => ({ id: candidate.messageId, company: candidate.company, title: candidate.title, submittedDate: candidate.submittedDate }))
      const duplicate = findPossibleDuplicate(outcome.candidate, [...existingReviewApplications, ...proposedThisSync])
      if (duplicate?.kind === 'exact') {
        return createProcessedGmailMessage({
          messageId: outcome.candidate.messageId,
          disposition: 'ignored',
          processedAt: syncedAt,
        })
      }
    }
    newCandidates.push(outcome.candidate)
    return outcome.processed
  })
  await repository.commitGmailSync({
    candidates: newCandidates,
    processedMessages,
    syncState: nextState,
    removedCandidateIds: [...refreshCandidateIds].filter((messageId) => !newCandidates.some((candidate) => candidate.messageId === messageId)),
  })

  return {
    newCandidates: newCandidates.length,
    inspectedMessages: pendingIds.length,
    mode,
    syncedAt,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

function epochSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / 1000)
}

function localDate(iso: string): string {
  const date = new Date(iso)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
