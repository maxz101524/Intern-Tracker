import { MUSE_LEDGER_SCHEMA, type MuseBatch, type MuseEntryPayload, type MuseLedger, type MuseStatusPayload } from '../../shared/museContract'
import { STAGE_ACTIONS } from './attention'
import { createApplication } from './entries'
import { findPossibleDuplicate, matchGmailStatusToApplications } from './gmail'
import { entryIdentity } from './restore'
import { appendStatus, getCurrentStatus } from './status'
import type {
  ApplicationEntry,
  AppSettings,
  GmailCandidate,
  MuseData,
  MuseEntryItem,
  MuseFillField,
  MuseItem,
  MuseStatusItem,
  MuseSyncState,
} from './types'

export interface MuseIncomingBatch {
  id: string
  receivedAt: string
  batch: MuseBatch
}

export interface MuseIngestSummary {
  created: number
  filled: number
  statuses: number
  review: number
  skipped: number
}

export interface MuseIngestPlan {
  items: MuseItem[]
  entryWrites: ApplicationEntry[]
  gmailResolutions: GmailCandidate[]
  summary: MuseIngestSummary
}

const FILL_FIELDS: MuseFillField[] = ['url', 'source', 'resumeVariant', 'notes', 'origin']

export function emptyMuseData(): MuseData {
  return { items: [], syncState: { key: 'muse' } }
}

export function museItemKey(kind: 'entry' | 'status', id: string): string {
  return `${kind}:${id}`
}

export function planMuseIngest({ batches, entries, knownKeys, gmailCandidates, receivedAt }: {
  batches: MuseIncomingBatch[]
  entries: ApplicationEntry[]
  knownKeys: Set<string>
  gmailCandidates: GmailCandidate[]
  receivedAt: string
}): MuseIngestPlan {
  const working = new Map(entries.map((entry) => [entry.id, entry]))
  const changed = new Set<string>()
  const seen = new Set(knownKeys)
  const items: MuseItem[] = []
  const resolutions = new Map<string, GmailCandidate>()
  const summary: MuseIngestSummary = { created: 0, filled: 0, statuses: 0, review: 0, skipped: 0 }

  function write(entry: ApplicationEntry) {
    working.set(entry.id, entry)
    changed.add(entry.id)
  }

  function resolveGmail(messageId: string | undefined, entryId: string) {
    if (!messageId || resolutions.has(messageId)) return
    const candidate = gmailCandidates.find((item) => item.messageId === messageId && item.state === 'pending')
    if (candidate) resolutions.set(messageId, { ...candidate, state: 'imported', linkedEntryId: entryId, reviewedAt: receivedAt })
  }

  function record(item: MuseItem) {
    items.push(item)
    if (item.state === 'pending') summary.review += 1
    else if (item.state === 'skipped') summary.skipped += 1
    else if (item.result?.action === 'created') summary.created += 1
    else if (item.result?.action === 'filled') summary.filled += 1
    else if (item.result?.action === 'status_added') summary.statuses += 1
  }

  for (const { id: streamId, batch } of batches) {
    const base = { batchId: batch.batchId, streamId, receivedAt }

    for (const payload of batch.newEntries) {
      const key = museItemKey('entry', payload.id)
      if (seen.has(key)) continue
      seen.add(key)
      const item: MuseEntryItem = { ...base, key, kind: 'entry', payload, state: 'pending' }

      let application: ApplicationEntry
      try {
        application = createMuseApplication(payload, receivedAt)
      } catch (caught) {
        record({ ...item, reason: 'invalid', detail: caught instanceof Error ? caught.message : 'This role is not valid.' })
        continue
      }
      if (working.has(payload.id)) {
        record({ ...item, state: 'skipped' })
        continue
      }

      const confirmed = payload.origin ? findEntryByMessageId([...working.values()], payload.origin.messageId) : undefined
      if (confirmed) {
        const { entry: filled, fields } = fillBlankFields(confirmed, payload, receivedAt)
        if (fields.length) write(filled)
        record({ ...item, state: fields.length ? 'applied' : 'skipped', result: { entryId: confirmed.id, action: 'filled', filledFields: fields } })
        resolveGmail(payload.origin?.messageId, confirmed.id)
        continue
      }

      const duplicate = findPossibleDuplicate(payload, [...working.values()])
      if (duplicate) {
        record({ ...item, reason: 'possible_duplicate', suggestedEntryIds: [duplicate.entryId] })
        continue
      }

      write(application)
      record({ ...item, state: 'applied', result: { entryId: application.id, action: 'created' } })
      resolveGmail(payload.origin?.messageId, application.id)
    }

    for (const payload of batch.statusUpdates) {
      const key = museItemKey('status', payload.id)
      if (seen.has(key)) continue
      seen.add(key)
      const item: MuseStatusItem = { ...base, key, kind: 'status', payload, state: 'pending' }
      const current = [...working.values()]

      const recorded = current.find((entry) => entry.statusHistory.some((event) =>
        event.id === payload.id || (payload.origin && event.origin?.messageId === payload.origin.messageId),
      ))
      if (recorded) {
        record({ ...item, state: 'skipped', result: { entryId: recorded.id, action: 'status_added' } })
        continue
      }

      const target = resolveStatusTarget(payload, current)
      if (!target) {
        record({
          ...item,
          reason: 'unmatched',
          suggestedEntryIds: suggestStatusTargets(payload, current),
          detail: payload.entryId ? 'Muse referred to a role that is not in Paceboard.' : undefined,
        })
        continue
      }

      const suggested = { suggestedEntryIds: [target.id] }
      if (payload.date < target.submittedDate) {
        record({ ...item, ...suggested, reason: 'invalid', detail: 'The event date is before the role’s submission date.' })
        continue
      }
      if (payload.confidence === 'low') {
        record({ ...item, ...suggested, reason: 'low_confidence' })
        continue
      }
      const currentStatus = getCurrentStatus(target)
      if (currentStatus === payload.status && !payload.newRound) {
        record({ ...item, state: 'skipped', result: { entryId: target.id, action: 'status_added' } })
        continue
      }
      if (currentStatus === 'rejected' || currentStatus === 'withdrawn') {
        record({ ...item, ...suggested, reason: 'closed_application' })
        continue
      }

      const applied = applyMuseStatus(target, payload)
      write(applied.entry)
      record({ ...item, state: 'applied', result: { entryId: target.id, action: 'status_added', ...(applied.nextActionSet ? { nextActionSet: true } : {}) } })
      resolveGmail(payload.origin?.messageId, target.id)
    }
  }

  return {
    items: items.map(withoutEmptyFields),
    entryWrites: [...changed].map((id) => working.get(id) as ApplicationEntry),
    gmailResolutions: [...resolutions.values()],
    summary,
  }
}

export function createMuseApplication(payload: MuseEntryPayload, updatedAt = new Date().toISOString(), id = payload.id): ApplicationEntry {
  return createApplication({
    id,
    company: payload.company,
    title: payload.title,
    submittedDate: payload.submittedDate,
    effort: payload.effort,
    source: payload.source,
    url: payload.url,
    resumeVariant: payload.resumeVariant,
    notes: payload.notes,
    origin: payload.origin,
    statusHistory: payload.statusHistory?.map((event) => ({ ...event })),
    updatedAt,
  })
}

/**
 * Appends Muse's event (a same-stage event only when Muse marks it a new round). When Muse knows a
 * deadline, it becomes the next action unless you have your own open plan; an open stage reminder
 * from an earlier round is replaced, a plan you wrote never is.
 */
export function applyMuseStatus(entry: ApplicationEntry, payload: MuseStatusPayload): { entry: ApplicationEntry; nextActionSet: boolean } {
  const updated = appendStatus(entry, payload.status, payload.date, payload.origin, payload.id, payload.newRound === true)
  const nextAction = museNextActionText(payload)
  const stageReminder = Object.values(STAGE_ACTIONS).some((label) => entry.nextAction?.startsWith(label))
  const hasOpenAction = Boolean(entry.nextAction?.trim()) && !entry.nextActionCompleted && !stageReminder
  if (updated === entry || !nextAction || !payload.dueDate || hasOpenAction) return { entry: updated, nextActionSet: false }
  const next: ApplicationEntry = { ...updated, nextAction, nextActionDueDate: payload.dueDate, nextActionCompleted: false }
  delete next.nextActionCompletedAt
  return { entry: next, nextActionSet: true }
}

function museNextActionText(payload: MuseStatusPayload): string | undefined {
  const action = STAGE_ACTIONS[payload.status]
  if (!action) return undefined
  return (payload.note ? `${action} — ${payload.note}` : action).slice(0, 200)
}

export function fillBlankFields(
  entry: ApplicationEntry,
  payload: MuseEntryPayload,
  updatedAt = new Date().toISOString(),
): { entry: ApplicationEntry; fields: MuseFillField[] } {
  const next: ApplicationEntry = { ...entry }
  const fields: MuseFillField[] = []
  for (const field of FILL_FIELDS) {
    if (field === 'origin') {
      const messageId = payload.origin?.messageId
      const used = messageId && entry.statusHistory.some((event) => event.origin?.messageId === messageId)
      if (!entry.origin && payload.origin && !used) {
        next.origin = { ...payload.origin }
        fields.push(field)
      }
    } else if (!entry[field] && payload[field]) {
      next[field] = payload[field]
      fields.push(field)
    }
  }
  return { entry: fields.length ? { ...next, updatedAt } : entry, fields }
}

export function undoMuseItem(item: MuseItem, entries: ApplicationEntry[]): { write?: ApplicationEntry; deleteId?: string } | null {
  if (item.state !== 'applied' || !item.result) return null
  const entry = entries.find((candidate) => candidate.id === item.result?.entryId)
  if (!entry) return null
  const updatedAt = new Date().toISOString()

  if (item.kind === 'status') {
    const statusHistory = entry.statusHistory.filter((event) => event.id !== item.payload.id)
    if (statusHistory.length === entry.statusHistory.length) return null
    const next: ApplicationEntry = { ...entry, statusHistory, updatedAt }
    if (item.result.nextActionSet && entry.nextAction === museNextActionText(item.payload) && !entry.nextActionCompleted) {
      delete next.nextAction
      delete next.nextActionDueDate
      delete next.nextActionCompleted
    }
    return { write: next }
  }
  if (item.result.action === 'created') return { deleteId: entry.id }

  const next: ApplicationEntry = { ...entry }
  for (const field of item.result.filledFields ?? []) {
    if (field === 'origin') {
      if (next.origin?.messageId === item.payload.origin?.messageId) delete next.origin
    } else if (next[field] === item.payload[field]) {
      delete next[field]
    }
  }
  return { write: { ...next, updatedAt } }
}

export function buildLedger(
  entries: ApplicationEntry[],
  settings: AppSettings,
  syncState: MuseSyncState,
  pendingMuseReview: number,
  generatedAt = new Date().toISOString(),
): MuseLedger {
  const ledger: MuseLedger = {
    schema: MUSE_LEDGER_SCHEMA,
    generatedAt,
    pendingMuseReview,
    vocabulary: { sources: [...settings.sources], resumeVariants: [...(settings.resumeVariants ?? [])] },
    entries: entries.map((entry) => withoutEmptyFields({
      id: entry.id,
      company: entry.company,
      title: entry.title,
      submittedDate: entry.submittedDate,
      url: entry.url,
      source: entry.source,
      status: getCurrentStatus(entry),
      statusHistory: entry.statusHistory.map(({ id, status, date }) => ({ id, status, date })),
    })),
  }
  if (syncState.cursor) ledger.museCursor = syncState.cursor
  if (syncState.lastPulledAt) ledger.lastPulledAt = syncState.lastPulledAt
  return ledger
}

export function ledgerHash(ledger: MuseLedger): string {
  // Timestamps change on every pull; only publish when the content Muse relies on changes.
  const stable: Partial<MuseLedger> = { ...ledger }
  delete stable.generatedAt
  delete stable.lastPulledAt
  return cyrb53(JSON.stringify(stable))
}

function resolveStatusTarget(payload: MuseStatusPayload, entries: ApplicationEntry[]): ApplicationEntry | undefined {
  const byId = payload.entryId ? entries.find((entry) => entry.id === payload.entryId) : undefined
  if (byId || !payload.match) return byId
  const identity = entryIdentity(payload.match)
  const matches = entries.filter((entry) => entryIdentity(entry) === identity)
  return matches.length === 1 ? matches[0] : undefined
}

function suggestStatusTargets(payload: MuseStatusPayload, entries: ApplicationEntry[]): string[] {
  if (!payload.match) return []
  return matchGmailStatusToApplications({ company: payload.match.company, title: payload.match.title, sender: '' }, entries)
}

function findEntryByMessageId(entries: ApplicationEntry[], messageId: string): ApplicationEntry | undefined {
  return entries.find((entry) => entry.origin?.messageId === messageId ||
    entry.statusHistory.some((event) => event.origin?.messageId === messageId))
}

function withoutEmptyFields<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function cyrb53(value: string): string {
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    first = Math.imul(first ^ code, 2654435761)
    second = Math.imul(second ^ code, 1597334677)
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(16)
}
