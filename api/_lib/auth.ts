import type { RelayEnv } from './env.js'
import { json } from './http.js'

export type RelayRole = 'muse' | 'paceboard'

export async function authorize(request: Request, role: RelayRole, env: RelayEnv): Promise<Response | null> {
  if (!env.MUSE_SYNC_KEY || !env.PACEBOARD_SYNC_KEY) {
    return json(503, { error: 'The Muse relay keys are not configured on this deployment.' })
  }
  const expected = role === 'muse' ? env.MUSE_SYNC_KEY : env.PACEBOARD_SYNC_KEY
  const presented = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!presented || !(await constantTimeEqual(presented, expected))) {
    return json(401, { error: 'Missing or invalid sync key.' })
  }
  return null
}

async function constantTimeEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)])
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}
