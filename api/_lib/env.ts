export interface RelayEnv {
  MUSE_SYNC_KEY?: string
  PACEBOARD_SYNC_KEY?: string
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  KV_REST_API_URL?: string
  KV_REST_API_TOKEN?: string
}

export function readEnv(): RelayEnv {
  const runtime = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return runtime.process?.env ?? {}
}
