import { planMuseDecisions, planMuseIngest, type MuseIngestSummary } from '../domain/muse'
import type { TrackerRepository } from '../storage/repository'
import type { MuseRelayClient } from './client'

// The relay trims batches after 90 days; warn a little before a long absence could lose any.
const RETENTION_WARNING_MS = 85 * 86_400_000

export interface MusePullOutcome {
  summary: MuseIngestSummary
  newDecisions: number
  batches: number
  retentionGap: boolean
  pulledAt: string
}

export async function pullMuse({
  client,
  repository,
  now = new Date(),
}: {
  client: MuseRelayClient
  repository: TrackerRepository
  now?: Date
}): Promise<MusePullOutcome> {
  const [muse, entries, pendingGmail] = await Promise.all([
    repository.getMuseData(),
    repository.listEntries(),
    repository.listGmailCandidates('pending'),
  ])
  const previous = muse.syncState
  const { batches, cursor } = await client.pullBatches(previous.cursor ?? null)
  const pulledAt = now.toISOString()
  const plan = planMuseIngest({
    batches,
    entries,
    knownKeys: new Set(muse.items.map((item) => item.key)),
    gmailCandidates: pendingGmail,
    receivedAt: pulledAt,
  })
  const decisions = planMuseDecisions(batches, muse.decisions ?? [], pulledAt)
  // Sticky until acknowledged in Settings: a long absence may have let the relay trim unseen batches.
  const retentionGap = previous.retentionGap === true ||
    Boolean(previous.lastPulledAt && now.getTime() - Date.parse(previous.lastPulledAt) > RETENTION_WARNING_MS)

  const syncState = { ...previous, lastPulledAt: pulledAt, retentionGap }
  if (cursor) syncState.cursor = cursor
  await repository.commitMuseIngest({
    items: plan.items,
    entryWrites: plan.entryWrites,
    gmailResolutions: plan.gmailResolutions,
    syncState,
    decisions,
  })
  const newDecisions = decisions.filter((decision) => decision.state === 'open').length
  return { summary: plan.summary, newDecisions, batches: batches.length, retentionGap, pulledAt }
}
