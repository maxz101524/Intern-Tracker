import { useCallback, useEffect, useRef, useState } from 'react'
import { createApplication } from '../domain/entries'
import { emptyGmailImportData } from '../domain/gmail'
import type { ApplicationEffort, GmailCandidate, GmailImportData } from '../domain/types'
import { GmailApiError, type GmailApiClient } from '../gmail/api'
import type { GmailAuthClient, GmailAuthState } from '../gmail/auth'
import { syncGmail, type GmailSyncResult } from '../gmail/sync'
import type { TrackerRepository } from '../storage/repository'

export interface GmailReviewInput {
  company: string
  title: string
  submittedDate: string
  effort: ApplicationEffort
}

export interface GmailImportController {
  authState: GmailAuthState
  gmailData: GmailImportData
  pendingCandidates: GmailCandidate[]
  syncStatus: 'idle' | 'syncing' | 'error'
  error: string
  lastResult: GmailSyncResult | null
  connectAndSync(): Promise<void>
  syncNow(): Promise<void>
  disconnect(): Promise<void>
  resetHistory(): Promise<void>
  refresh(): Promise<void>
  acceptCandidate(candidate: GmailCandidate, input: GmailReviewInput): Promise<void>
  dismissCandidate(candidate: GmailCandidate): Promise<void>
  clearLastResult(): void
}

export function useGmailImport(
  repository: TrackerRepository,
  auth: GmailAuthClient,
  createApi: (getAccessToken: () => string | null) => GmailApiClient,
  onEntriesChanged: () => Promise<void>,
): GmailImportController {
  const [authState, setAuthState] = useState(auth.getState())
  const [gmailData, setGmailData] = useState<GmailImportData>(emptyGmailImportData)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'error'>('idle')
  const [error, setError] = useState('')
  const [lastResult, setLastResult] = useState<GmailSyncResult | null>(null)
  const syncInFlight = useRef<Promise<void> | null>(null)
  const autoSyncAttempted = useRef(false)

  const refresh = useCallback(async () => {
    setGmailData(await repository.getGmailImportData())
  }, [repository])

  useEffect(() => auth.subscribe(setAuthState), [auth])
  useEffect(() => { void refresh() }, [refresh])

  const runSync = useCallback((token?: string): Promise<void> => {
    if (syncInFlight.current) return syncInFlight.current
    const operation = (async () => {
      setSyncStatus('syncing')
      setError('')
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          throw new Error('You appear to be offline. Gmail sync will retry when you are connected.')
        }
        const api = createApi(() => token ?? auth.getValidToken())
        const result = await syncGmail({ api, repository })
        await refresh()
        setLastResult(result)
        setSyncStatus('idle')
      } catch (caught) {
        if (caught instanceof GmailApiError && caught.code === 'authorization') auth.invalidate()
        const message = caught instanceof Error ? caught.message : 'Gmail could not be synchronized.'
        setError(message)
        setSyncStatus('error')
        throw caught
      }
    })().finally(() => {
      syncInFlight.current = null
    })
    syncInFlight.current = operation
    return operation
  }, [auth, createApi, refresh, repository])

  useEffect(() => {
    if (autoSyncAttempted.current) return
    autoSyncAttempted.current = true
    const token = auth.getValidToken()
    if (token) void runSync(token).catch(() => undefined)
  }, [auth, runSync])

  const connectAndSync = useCallback(async () => {
    try {
      const token = await auth.requestToken()
      await runSync(token)
    } catch (caught) {
      if (auth.getState().status === 'error') {
        setError(auth.getState().error ?? 'Google authorization was not completed.')
      }
      throw caught
    }
  }, [auth, runSync])

  const syncNow = useCallback(async () => {
    const token = auth.getValidToken() ?? await auth.requestToken()
    await runSync(token)
  }, [auth, runSync])

  const disconnect = useCallback(async () => {
    await auth.disconnect()
    setError('')
    setSyncStatus('idle')
  }, [auth])

  const resetHistory = useCallback(async () => {
    await repository.resetGmailImportHistory()
    await refresh()
    setError('')
    setSyncStatus('idle')
  }, [refresh, repository])

  const acceptCandidate = useCallback(async (candidate: GmailCandidate, input: GmailReviewInput) => {
    const application = createApplication({
      ...input,
      origin: { provider: 'gmail', messageId: candidate.messageId },
    })
    await repository.reviewGmailCandidate({
      candidate,
      disposition: 'imported',
      application,
      reviewedAt: new Date().toISOString(),
    })
    await Promise.all([refresh(), onEntriesChanged()])
  }, [onEntriesChanged, refresh, repository])

  const dismissCandidate = useCallback(async (candidate: GmailCandidate) => {
    await repository.reviewGmailCandidate({
      candidate,
      disposition: 'dismissed',
      reviewedAt: new Date().toISOString(),
    })
    await refresh()
  }, [refresh, repository])

  const clearLastResult = useCallback(() => setLastResult(null), [])

  return {
    authState,
    gmailData,
    pendingCandidates: gmailData.candidates.filter((candidate) => candidate.state === 'pending'),
    syncStatus,
    error,
    lastResult,
    connectAndSync,
    syncNow,
    disconnect,
    resetHistory,
    refresh,
    acceptCandidate,
    dismissCandidate,
    clearLastResult,
  }
}
