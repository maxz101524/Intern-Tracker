import {
  MUSE_BATCH_SCHEMA,
  MUSE_LEDGER_SCHEMA,
  MUSE_MAX_BATCH_BYTES,
  MUSE_MAX_LEDGER_BYTES,
  validateLedger,
  validateMuseBatch,
} from '../../shared/museContract.js'
import { authorize } from './auth.js'
import { readEnv, type RelayEnv } from './env.js'
import { byteLength, json, methodNotAllowed } from './http.js'
import { STREAM_ID_PATTERN, type RelayStore } from './store.js'
import { createUpstashStore } from './upstashStore.js'

export const RETENTION_MS = 90 * 86_400_000
const PAGE_LIMIT = 50

export interface RelayDeps {
  env: RelayEnv
  store: () => RelayStore | null
  now: () => Date
}

let defaultStore: RelayStore | null | undefined

export function defaultDeps(): RelayDeps {
  const env = readEnv()
  return {
    env,
    store: () => {
      if (defaultStore === undefined) defaultStore = createUpstashStore(env)
      return defaultStore
    },
    now: () => new Date(),
  }
}

export async function handleBatches(request: Request, deps: RelayDeps): Promise<Response> {
  if (request.method === 'POST') {
    return guarded(request, 'muse', deps, async (store) => {
      const body = await readJson(request, MUSE_MAX_BATCH_BYTES)
      if (body instanceof Response) return body
      const result = validateMuseBatch(body)
      if (!result.ok) return json(400, { error: `The batch does not match ${MUSE_BATCH_SCHEMA}.`, issues: result.issues })
      const { id, duplicate } = await store.appendBatch(result.batch, deps.now().toISOString(), RETENTION_MS)
      return json(duplicate ? 200 : 201, { id, duplicate })
    })
  }
  if (request.method === 'GET') {
    return guarded(request, 'paceboard', deps, async (store) => {
      const params = new URL(request.url).searchParams
      const after = params.get('after') || null
      if (after && !STREAM_ID_PATTERN.test(after)) return json(400, { error: 'The cursor is not valid.' })
      const requested = Number(params.get('limit') ?? PAGE_LIMIT)
      const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), PAGE_LIMIT) : PAGE_LIMIT
      const { batches, hasMore, oldestId } = await store.readBatches(after, limit)
      return json(200, { batches, hasMore, nextCursor: batches.at(-1)?.id ?? after, oldestId })
    })
  }
  return methodNotAllowed('GET, POST')
}

export async function handleLedger(request: Request, deps: RelayDeps): Promise<Response> {
  if (request.method === 'GET') {
    return guarded(request, 'muse', deps, async (store) => {
      const ledger = await store.getLedger()
      return ledger ? json(200, ledger) : json(404, { error: 'Paceboard has not published a ledger yet.' })
    })
  }
  if (request.method === 'PUT') {
    return guarded(request, 'paceboard', deps, async (store) => {
      const body = await readJson(request, MUSE_MAX_LEDGER_BYTES)
      if (body instanceof Response) return body
      const result = validateLedger(body)
      if (!result.ok) return json(400, { error: `The ledger does not match ${MUSE_LEDGER_SCHEMA}.`, issues: result.issues })
      await store.putLedger(result.ledger)
      return json(200, { ok: true })
    })
  }
  return methodNotAllowed('GET, PUT')
}

async function guarded(
  request: Request,
  role: 'muse' | 'paceboard',
  deps: RelayDeps,
  operation: (store: RelayStore) => Promise<Response>,
): Promise<Response> {
  const denied = await authorize(request, role, deps.env)
  if (denied) return denied
  const store = deps.store()
  if (!store) return json(503, { error: 'The Muse relay storage is not configured on this deployment.' })
  try {
    return await operation(store)
  } catch {
    // Store errors can include connection details; keep them out of responses.
    return json(502, { error: 'The relay store is unavailable. Try again shortly.' })
  }
}

async function readJson(request: Request, maxBytes: number): Promise<unknown | Response> {
  const raw = await request.text()
  if (byteLength(raw) > maxBytes) return json(413, { error: `The body must be at most ${maxBytes} bytes.` })
  try {
    return JSON.parse(raw)
  } catch {
    return json(400, { error: 'The body must be valid JSON.' })
  }
}
