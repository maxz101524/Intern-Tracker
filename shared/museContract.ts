// Wire contract shared by the Muse relay (api/) and the Paceboard app (src/).
// Keep this file free of runtime imports so both bundlers and Vercel's Node runtime can load it.

export const MUSE_BATCH_SCHEMA = 'paceboard.muse-batch.v1'
export const MUSE_LEDGER_SCHEMA = 'paceboard.ledger.v1'
export const MUSE_MAX_ITEMS = 200
export const MUSE_MAX_BATCH_BYTES = 256_000
export const MUSE_MAX_LEDGER_BYTES = 1_000_000

const ALL_STATUSES = ['applied', 'online_assessment', 'recruiter_screen', 'interview', 'offer', 'rejected', 'withdrawn'] as const
const UPDATE_STATUSES = ALL_STATUSES.filter((status) => status !== 'applied')
const MAX_TEXT = 500
const MAX_NOTES = 4000

export type MuseStatus = Exclude<(typeof ALL_STATUSES)[number], 'applied'>

export interface MuseOrigin {
  provider: 'gmail'
  messageId: string
}

export interface MuseHistoryEvent {
  id: string
  status: (typeof ALL_STATUSES)[number]
  date: string
}

export interface MuseEntryPayload {
  id: string
  company: string
  title: string
  submittedDate: string
  effort: 'quick' | 'targeted'
  source?: string
  url?: string
  resumeVariant?: string
  notes?: string
  origin?: MuseOrigin
  statusHistory?: MuseHistoryEvent[]
}

export interface MuseMatch {
  company: string
  title: string
  submittedDate: string
}

export interface MuseStatusPayload {
  id: string
  entryId?: string
  match?: MuseMatch
  status: MuseStatus
  date: string
  origin?: MuseOrigin
  confidence: 'high' | 'low'
  note?: string
}

export interface MuseBatch {
  schema: typeof MUSE_BATCH_SCHEMA
  batchId: string
  generatedAt: string
  newEntries: MuseEntryPayload[]
  statusUpdates: MuseStatusPayload[]
}

export interface MuseLedgerEntry {
  id: string
  company: string
  title: string
  submittedDate: string
  url?: string
  source?: string
  status: string
  statusHistory: Array<{ id: string; status: string; date: string }>
}

export interface MuseLedger {
  schema: typeof MUSE_LEDGER_SCHEMA
  generatedAt: string
  museCursor?: string
  lastPulledAt?: string
  pendingMuseReview: number
  vocabulary: { sources: string[]; resumeVariants: string[] }
  entries: MuseLedgerEntry[]
}

export interface ContractIssue {
  path: string
  message: string
}

export type BatchValidation = { ok: true; batch: MuseBatch } | { ok: false; issues: ContractIssue[] }
export type LedgerValidation = { ok: true; ledger: MuseLedger } | { ok: false; issues: ContractIssue[] }

export function validateMuseBatch(value: unknown): BatchValidation {
  const issues: ContractIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', message: 'Batch must be a JSON object.' }] }

  if (value.schema !== MUSE_BATCH_SCHEMA) issues.push({ path: 'schema', message: `Expected "${MUSE_BATCH_SCHEMA}".` })
  const batchId = text(value.batchId, 'batchId', issues, { max: 200 })
  const generatedAt = timestamp(value.generatedAt, 'generatedAt', issues)
  const rawEntries = list(value.newEntries, 'newEntries', issues)
  const rawUpdates = list(value.statusUpdates, 'statusUpdates', issues)
  if (rawEntries.length + rawUpdates.length > MUSE_MAX_ITEMS) {
    issues.push({ path: '$', message: `A batch may contain at most ${MUSE_MAX_ITEMS} items.` })
  }

  const newEntries = rawEntries.map((entry, index) => entryPayload(entry, `newEntries[${index}]`, issues))
  const statusUpdates = rawUpdates.map((update, index) => statusPayload(update, `statusUpdates[${index}]`, issues))
  if (issues.length) return { ok: false, issues }
  return {
    ok: true,
    batch: {
      schema: MUSE_BATCH_SCHEMA,
      batchId: batchId as string,
      generatedAt: generatedAt as string,
      newEntries: newEntries as MuseEntryPayload[],
      statusUpdates: statusUpdates as MuseStatusPayload[],
    },
  }
}

export function validateLedger(value: unknown): LedgerValidation {
  const issues: ContractIssue[] = []
  if (!isRecord(value)) return { ok: false, issues: [{ path: '$', message: 'Ledger must be a JSON object.' }] }
  if (value.schema !== MUSE_LEDGER_SCHEMA) issues.push({ path: 'schema', message: `Expected "${MUSE_LEDGER_SCHEMA}".` })
  timestamp(value.generatedAt, 'generatedAt', issues)
  if (!isRecord(value.vocabulary) || !stringArray(value.vocabulary.sources) || !stringArray(value.vocabulary.resumeVariants)) {
    issues.push({ path: 'vocabulary', message: 'Vocabulary must list sources and resumeVariants.' })
  }
  if (!Number.isInteger(value.pendingMuseReview) || Number(value.pendingMuseReview) < 0) {
    issues.push({ path: 'pendingMuseReview', message: 'Expected a non-negative integer.' })
  }
  const entries = Array.isArray(value.entries) ? value.entries : null
  if (!entries) issues.push({ path: 'entries', message: 'Expected an array.' })
  entries?.forEach((entry, index) => {
    const path = `entries[${index}]`
    if (!isRecord(entry)) { issues.push({ path, message: 'Expected an object.' }); return }
    for (const field of ['id', 'company', 'title', 'status'] as const) text(entry[field], `${path}.${field}`, issues)
    date(entry.submittedDate, `${path}.submittedDate`, issues)
    if (!Array.isArray(entry.statusHistory)) issues.push({ path: `${path}.statusHistory`, message: 'Expected an array.' })
  })
  return issues.length ? { ok: false, issues } : { ok: true, ledger: value as unknown as MuseLedger }
}

function entryPayload(value: unknown, path: string, issues: ContractIssue[]): MuseEntryPayload | null {
  if (!isRecord(value)) { issues.push({ path, message: 'Expected an object.' }); return null }
  const payload: Partial<MuseEntryPayload> = {
    id: text(value.id, `${path}.id`, issues, { max: 200 }),
    company: text(value.company, `${path}.company`, issues),
    title: text(value.title, `${path}.title`, issues),
    submittedDate: date(value.submittedDate, `${path}.submittedDate`, issues),
  }
  if (value.effort !== 'quick' && value.effort !== 'targeted') {
    issues.push({ path: `${path}.effort`, message: 'Expected "quick" or "targeted".' })
  } else {
    payload.effort = value.effort
  }
  for (const field of ['source', 'url', 'resumeVariant'] as const) {
    if (value[field] !== undefined && value[field] !== null) payload[field] = text(value[field], `${path}.${field}`, issues)
  }
  if (value.notes !== undefined && value.notes !== null) payload.notes = text(value.notes, `${path}.notes`, issues, { max: MAX_NOTES })
  if (value.origin !== undefined && value.origin !== null) payload.origin = origin(value.origin, `${path}.origin`, issues)
  if (value.statusHistory !== undefined && value.statusHistory !== null) {
    payload.statusHistory = list(value.statusHistory, `${path}.statusHistory`, issues).map((event, index) => {
      const eventPath = `${path}.statusHistory[${index}]`
      if (!isRecord(event)) { issues.push({ path: eventPath, message: 'Expected an object.' }); return null }
      if (!ALL_STATUSES.includes(event.status as MuseHistoryEvent['status'])) {
        issues.push({ path: `${eventPath}.status`, message: 'Unknown status.' })
      }
      return {
        id: text(event.id, `${eventPath}.id`, issues, { max: 200 }),
        status: event.status,
        date: date(event.date, `${eventPath}.date`, issues),
      } as MuseHistoryEvent
    })
  }
  return withoutUndefined(payload) as MuseEntryPayload
}

function statusPayload(value: unknown, path: string, issues: ContractIssue[]): MuseStatusPayload | null {
  if (!isRecord(value)) { issues.push({ path, message: 'Expected an object.' }); return null }
  const payload: Partial<MuseStatusPayload> = {
    id: text(value.id, `${path}.id`, issues, { max: 200 }),
    date: date(value.date, `${path}.date`, issues),
  }
  if (!UPDATE_STATUSES.includes(value.status as MuseStatus)) {
    issues.push({ path: `${path}.status`, message: `Expected one of ${UPDATE_STATUSES.join(', ')}.` })
  } else {
    payload.status = value.status as MuseStatus
  }
  const confidence = value.confidence ?? 'high'
  if (confidence !== 'high' && confidence !== 'low') {
    issues.push({ path: `${path}.confidence`, message: 'Expected "high" or "low".' })
  } else {
    payload.confidence = confidence
  }
  if (value.entryId !== undefined && value.entryId !== null) payload.entryId = text(value.entryId, `${path}.entryId`, issues, { max: 200 })
  if (value.match !== undefined && value.match !== null) {
    if (!isRecord(value.match)) {
      issues.push({ path: `${path}.match`, message: 'Expected an object.' })
    } else {
      payload.match = {
        company: text(value.match.company, `${path}.match.company`, issues) as string,
        title: text(value.match.title, `${path}.match.title`, issues) as string,
        submittedDate: date(value.match.submittedDate, `${path}.match.submittedDate`, issues) as string,
      }
    }
  }
  if (payload.entryId === undefined && value.match === undefined) {
    issues.push({ path: `${path}.entryId`, message: 'Provide entryId or match.' })
  }
  if (value.origin !== undefined && value.origin !== null) payload.origin = origin(value.origin, `${path}.origin`, issues)
  if (value.note !== undefined && value.note !== null) payload.note = text(value.note, `${path}.note`, issues, { max: MAX_NOTES })
  return withoutUndefined(payload) as MuseStatusPayload
}

function origin(value: unknown, path: string, issues: ContractIssue[]): MuseOrigin | undefined {
  if (!isRecord(value) || value.provider !== 'gmail' || typeof value.messageId !== 'string' || !value.messageId.trim()) {
    issues.push({ path, message: 'Expected { provider: "gmail", messageId }.' })
    return undefined
  }
  return { provider: 'gmail', messageId: value.messageId.trim() }
}

function text(value: unknown, path: string, issues: ContractIssue[], { max = MAX_TEXT } = {}): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push({ path, message: 'Expected a non-empty string.' })
    return undefined
  }
  if (value.length > max) {
    issues.push({ path, message: `Must be at most ${max} characters.` })
    return undefined
  }
  return value.trim()
}

function date(value: unknown, path: string, issues: ContractIssue[]): string | undefined {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    const parsed = new Date(Date.UTC(year, month - 1, day))
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) return value
  }
  issues.push({ path, message: 'Expected a calendar date as YYYY-MM-DD.' })
  return undefined
}

function timestamp(value: unknown, path: string, issues: ContractIssue[]): string | undefined {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value
  issues.push({ path, message: 'Expected an ISO 8601 timestamp.' })
  return undefined
}

function list(value: unknown, path: string, issues: ContractIssue[]): unknown[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value
  issues.push({ path, message: 'Expected an array.' })
  return []
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}
