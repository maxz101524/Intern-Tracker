import { createGmailCandidate, createProcessedGmailMessage } from '../domain/gmail'
import type { GmailSyncState } from '../domain/types'
import type { TrackerRepository } from '../storage/repository'
import { GmailApiError, type GmailApiClient } from './api'
import { detectApplicationConfirmation } from './detector'
import { normalizeGmailMessage } from './message'

const INITIAL_DAYS = 30
const RECOVERY_DAYS = 2
const DAY_MS = 86_400_000
const MESSAGE_CONCURRENCY = 5

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

  const knownIds = new Set([
    ...processed.map((message) => message.messageId),
    ...candidates.map((candidate) => candidate.messageId),
    ...entries.flatMap((entry) => entry.origin?.provider === 'gmail' ? [entry.origin.messageId] : []),
  ])
  const pendingIds = [...new Set(messageIds)].filter((id) => !knownIds.has(id))
  const outcomes = await mapWithConcurrency(pendingIds, MESSAGE_CONCURRENCY, async (messageId) => {
    const raw = await api.getMessage(messageId)
    try {
      const message = normalizeGmailMessage(raw)
      const detected = detectApplicationConfirmation(message)
      if (!detected) {
        return {
          processed: createProcessedGmailMessage({ messageId, disposition: 'ignored', processedAt: syncedAt }),
        }
      }
      const candidate = createGmailCandidate({
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
      })
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
  }
  const newCandidates = outcomes.flatMap((outcome) => outcome.candidate ? [outcome.candidate] : [])
  await repository.commitGmailSync({
    candidates: newCandidates,
    processedMessages: outcomes.map((outcome) => outcome.processed),
    syncState: nextState,
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
