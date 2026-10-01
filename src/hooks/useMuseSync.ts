import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  applyMuseStatus,
  buildLedger,
  createMuseApplication,
  emptyMuseData,
  fillBlankFields,
  ledgerHash,
  undoMuseItem,
} from '../domain/muse'
import type { ApplicationEntry, AppSettings, MuseData, MuseEntryItem, MuseItem, MuseStatusItem } from '../domain/types'
import { MuseRelayError, type MuseRelayClient, type MuseRelayErrorCode } from '../muse/client'
import { clearMuseKey, getMuseKey, setMuseKey } from '../muse/keyStore'
import { pullMuse, type MusePullOutcome } from '../muse/sync'
import type { TrackerRepository } from '../storage/repository'

const VISIBILITY_THROTTLE_MS = 60_000
const LEDGER_DEBOUNCE_MS = 2_000

export interface MuseSyncController {
  connected: boolean
  status: 'idle' | 'syncing' | 'error'
  error: string
  errorCode?: MuseRelayErrorCode
  data: MuseData
  pendingItems: MuseItem[]
  appliedItems: MuseItem[]
  dismissedItems: MuseItem[]
  lastResult: MusePullOutcome | null
  connect(key: string): Promise<void>
  disconnect(): void
  pullNow(): Promise<void>
  resolveEntry(item: MuseEntryItem, choice: { mode: 'fill' | 'create'; entryId?: string }): Promise<void>
  applyStatus(item: MuseStatusItem, entryId: string): Promise<void>
  dismiss(item: MuseItem): Promise<void>
  restore(item: MuseItem): Promise<void>
  undo(item: MuseItem): Promise<void>
  acknowledgeRetentionGap(): Promise<void>
  refresh(): Promise<void>
  clearLastResult(): void
}

export function useMuseSync({
  repository,
  client,
  entries,
  settings,
  onEntriesChanged,
  pollIntervalMs = 10 * 60_000,
}: {
  repository: TrackerRepository
  client: MuseRelayClient
  entries: ApplicationEntry[]
  settings: AppSettings | null
  onEntriesChanged: () => Promise<void>
  pollIntervalMs?: number
}): MuseSyncController {
  const [connected, setConnected] = useState(() => Boolean(getMuseKey()))
  const [data, setData] = useState<MuseData>(emptyMuseData)
  const [status, setStatus] = useState<MuseSyncController['status']>('idle')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState<MuseRelayErrorCode>()
  const [lastResult, setLastResult] = useState<MusePullOutcome | null>(null)
  const pullInFlight = useRef<Promise<void> | null>(null)
  const publishInFlight = useRef<Promise<void> | null>(null)
  const lastAttempt = useRef(0)

  const refresh = useCallback(async () => {
    setData(await repository.getMuseData())
  }, [repository])

  useEffect(() => { void refresh() }, [refresh])

  const fail = useCallback((caught: unknown) => {
    const code = caught instanceof MuseRelayError ? caught.code : undefined
    if (code === 'unauthorized' || code === 'missing-key') {
      clearMuseKey()
      setConnected(false)
    }
    setErrorCode(code)
    setError(caught instanceof Error ? caught.message : 'Muse sync failed.')
    setStatus('error')
  }, [])

  const publishLedger = useCallback((): Promise<void> => {
    if (publishInFlight.current) return publishInFlight.current
    const operation = (async () => {
      if (!getMuseKey()) return
      const [currentEntries, currentSettings, muse] = await Promise.all([
        repository.listEntries(), repository.getSettings(), repository.getMuseData(),
      ])
      const pending = muse.items.filter((item) => item.state === 'pending').length
      const ledger = buildLedger(currentEntries, currentSettings, muse.syncState, pending)
      const hash = ledgerHash(ledger)
      if (hash === muse.syncState.lastLedgerHash) return
      try {
        await client.publishLedger(ledger)
      } catch (caught) {
        // A failed publish retries on the next change or pull; only a rejected key needs attention now.
        if (caught instanceof MuseRelayError && caught.code === 'unauthorized') fail(caught)
        return
      }
      await repository.patchMuseSyncState({ lastLedgerHash: hash, lastLedgerPublishedAt: ledger.generatedAt })
      await refresh()
    })().finally(() => { publishInFlight.current = null })
    publishInFlight.current = operation
    return operation
  }, [client, fail, refresh, repository])

  const runPull = useCallback((): Promise<void> => {
    if (pullInFlight.current) return pullInFlight.current
    lastAttempt.current = Date.now()
    const operation = (async () => {
      setStatus('syncing')
      setError('')
      setErrorCode(undefined)
      try {
        const outcome = await pullMuse({ client, repository })
        await Promise.all([refresh(), onEntriesChanged()])
        setLastResult(outcome)
        setStatus('idle')
      } catch (caught) {
        fail(caught)
        throw caught
      }
      await publishLedger()
    })().finally(() => { pullInFlight.current = null })
    pullInFlight.current = operation
    return operation
  }, [client, fail, onEntriesChanged, publishLedger, refresh, repository])

  useEffect(() => {
    if (!connected) return
    void runPull().catch(() => undefined)
    function onVisible() {
      if (document.visibilityState === 'visible' && Date.now() - lastAttempt.current > VISIBILITY_THROTTLE_MS) {
        void runPull().catch(() => undefined)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = pollIntervalMs > 0
      ? window.setInterval(() => {
        if (document.visibilityState !== 'hidden') void runPull().catch(() => undefined)
      }, pollIntervalMs)
      : undefined
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (timer !== undefined) window.clearInterval(timer)
    }
    // runPull is stable for a given client and repository; re-running on its identity would re-pull on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, pollIntervalMs])

  useEffect(() => {
    if (!connected || !settings) return
    const timer = window.setTimeout(() => { void publishLedger() }, LEDGER_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [connected, entries, settings, data.items, publishLedger])

  const connect = useCallback(async (key: string) => {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('Paste the Paceboard sync key first.')
    setMuseKey(trimmed)
    setConnected(true)
    await runPull()
  }, [runPull])

  const disconnect = useCallback(() => {
    clearMuseKey()
    setConnected(false)
    setError('')
    setErrorCode(undefined)
    setStatus('idle')
  }, [])

  const afterReview = useCallback(async () => {
    await Promise.all([refresh(), onEntriesChanged()])
  }, [onEntriesChanged, refresh])

  const findEntry = useCallback(async (entryId: string | undefined) => {
    const entry = (await repository.listEntries()).find((candidate) => candidate.id === entryId)
    if (!entry) throw new Error('Choose the role this belongs to.')
    return entry
  }, [repository])

  const resolveEntry = useCallback(async (item: MuseEntryItem, choice: { mode: 'fill' | 'create'; entryId?: string }) => {
    const reviewedAt = new Date().toISOString()
    if (choice.mode === 'fill') {
      const target = await findEntry(choice.entryId ?? item.suggestedEntryIds?.[0])
      const { entry, fields } = fillBlankFields(target, item.payload, reviewedAt)
      await repository.reviewMuseItem({
        item: { ...item, state: 'applied', reviewedAt, result: { entryId: target.id, action: 'filled', filledFields: fields } },
        entryWrites: fields.length ? [entry] : [],
      })
    } else {
      const existingIds = new Set((await repository.listEntries()).map((entry) => entry.id))
      const id = existingIds.has(item.payload.id) ? crypto.randomUUID() : item.payload.id
      const application = createMuseApplication(item.payload, reviewedAt, id)
      await repository.reviewMuseItem({
        item: { ...item, state: 'applied', reviewedAt, result: { entryId: application.id, action: 'created' } },
        entryWrites: [application],
      })
    }
    await afterReview()
  }, [afterReview, findEntry, repository])

  const applyStatus = useCallback(async (item: MuseStatusItem, entryId: string) => {
    const reviewedAt = new Date().toISOString()
    const target = await findEntry(entryId)
    const { entry: updated, nextActionSet } = applyMuseStatus(target, item.payload)
    const changed = updated !== target
    await repository.reviewMuseItem({
      item: { ...item, state: changed ? 'applied' : 'skipped', reviewedAt, result: { entryId: target.id, action: 'status_added', ...(nextActionSet ? { nextActionSet } : {}) } },
      entryWrites: changed ? [updated] : [],
    })
    await afterReview()
  }, [afterReview, findEntry, repository])

  const dismiss = useCallback(async (item: MuseItem) => {
    await repository.reviewMuseItem({ item: { ...item, state: 'dismissed', reviewedAt: new Date().toISOString() } })
    await afterReview()
  }, [afterReview, repository])

  const restore = useCallback(async (item: MuseItem) => {
    const restored = { ...item, state: 'pending' as const, reason: item.reason ?? 'undone' as const }
    delete restored.reviewedAt
    await repository.reviewMuseItem({ item: restored })
    await afterReview()
  }, [afterReview, repository])

  const undo = useCallback(async (item: MuseItem) => {
    const change = undoMuseItem(item, await repository.listEntries())
    await repository.reviewMuseItem({
      item: { ...item, state: 'dismissed', reason: 'undone', reviewedAt: new Date().toISOString() },
      entryWrites: change?.write ? [change.write] : [],
      deleteEntryIds: change?.deleteId ? [change.deleteId] : [],
    })
    await afterReview()
  }, [afterReview, repository])

  const acknowledgeRetentionGap = useCallback(async () => {
    await repository.patchMuseSyncState({ retentionGap: false })
    await refresh()
  }, [refresh, repository])

  const lists = useMemo(() => {
    const newestFirst = (left: MuseItem, right: MuseItem) =>
      (right.reviewedAt ?? right.receivedAt).localeCompare(left.reviewedAt ?? left.receivedAt)
    return {
      pendingItems: data.items.filter((item) => item.state === 'pending'),
      appliedItems: data.items.filter((item) => item.state === 'applied').sort(newestFirst),
      dismissedItems: data.items.filter((item) => item.state === 'dismissed').sort(newestFirst),
    }
  }, [data.items])

  const clearLastResult = useCallback(() => setLastResult(null), [])

  return {
    connected,
    status,
    error,
    errorCode,
    data,
    ...lists,
    lastResult,
    connect,
    disconnect,
    pullNow: runPull,
    resolveEntry,
    applyStatus,
    dismiss,
    restore,
    undo,
    acknowledgeRetentionGap,
    refresh,
    clearLastResult,
  }
}
