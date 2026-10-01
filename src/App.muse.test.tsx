import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { compareStreamIds, MUSE_BATCH_SCHEMA, type MuseBatch, type MuseLedger } from '../shared/museContract'
import { App } from './App'
import { createApplication } from './domain/entries'
import type { MuseIncomingBatch } from './domain/muse'
import { MuseRelayError, type MuseRelayClient } from './muse/client'
import { TrackerRepository } from './storage/repository'

const KEY_STORAGE = 'paceboard.museSyncKey'

function fakeMuse(batches: MuseIncomingBatch[] = []) {
  const ledgers: MuseLedger[] = []
  const state = { unauthorized: false }
  const client: MuseRelayClient = {
    async pullBatches(after) {
      if (state.unauthorized) throw new MuseRelayError('unauthorized', 'The sync key was rejected. Paste the current Paceboard sync key to reconnect.')
      const newer = batches.filter((item) => !after || compareStreamIds(item.id, after) > 0)
      return { batches: newer, cursor: newer.at(-1)?.id ?? after, oldestId: batches[0]?.id ?? null }
    },
    async publishLedger(ledger) { ledgers.push(ledger) },
  }
  return { client, ledgers, state }
}

function batch(id: string, contents: Partial<MuseBatch>): MuseIncomingBatch {
  return {
    id,
    receivedAt: '2026-10-02T12:00:00Z',
    batch: { schema: MUSE_BATCH_SCHEMA, batchId: `run-${id}`, generatedAt: '2026-10-02T12:00:00Z', newEntries: [], statusUpdates: [], ...contents },
  }
}

const scaleRole = {
  id: 'muse-scale', company: 'Scale AI', title: 'ML Research Intern', submittedDate: '2026-10-01', effort: 'quick' as const,
  source: 'Company site', url: 'https://scale.example/jobs/1', resumeVariant: 'ML', notes: '$52/hr private note',
}

describe('Muse sync in Paceboard', () => {
  let repository: TrackerRepository

  beforeEach(async () => {
    localStorage.clear()
    repository = new TrackerRepository(`paceboard-muse-ui-${crypto.randomUUID()}`)
    await repository.saveSettings({ weeklyTarget: 35, sources: ['LinkedIn', 'Company site'], lastBackupAt: null })
  })

  afterEach(async () => {
    cleanup()
    await repository.destroy()
  })

  it('connects with a sync key, adds Muse roles automatically, and shares a ledger without notes', async () => {
    const user = userEvent.setup()
    const muse = fakeMuse([batch('1000-0', { newEntries: [scaleRole] })])
    render(<App repository={repository} museClient={muse.client} musePollIntervalMs={0} />)

    await user.click(await screen.findByRole('button', { name: 'Settings & data' }))
    await user.type(screen.getByLabelText('Paceboard sync key'), 'paceboard-secret')
    await user.click(screen.getByRole('button', { name: 'Connect Muse' }))

    expect(await screen.findByText('Muse: 1 role added')).toBeVisible()
    expect(localStorage.getItem(KEY_STORAGE)).toBe('paceboard-secret')
    expect(await repository.listEntries()).toEqual([expect.objectContaining({ id: 'muse-scale', resumeVariant: 'ML' })])
    expect(screen.getByText('Connected')).toBeVisible()

    await waitFor(() => expect(muse.ledgers.length).toBeGreaterThan(0))
    const ledger = muse.ledgers.at(-1) as MuseLedger
    expect(ledger.entries.map((entry) => entry.id)).toEqual(['muse-scale'])
    expect(ledger.museCursor).toBe('1000-0')
    expect(JSON.stringify(ledger)).not.toContain('private note')
  })

  it('asks about a likely duplicate and fills blanks on the existing role', async () => {
    const user = userEvent.setup()
    const existing = createApplication({ company: 'Scale AI', title: 'Machine Learning Research Intern', submittedDate: '2026-09-30', effort: 'quick' })
    await repository.saveEntry(existing)
    localStorage.setItem(KEY_STORAGE, 'paceboard-secret')
    const muse = fakeMuse([batch('1000-0', { newEntries: [scaleRole] })])
    render(<App repository={repository} museClient={muse.client} musePollIntervalMs={0} />)

    expect(await screen.findByText('Muse: 1 needs review')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Review, 1 pending' }))
    const card = await screen.findByRole('article', { name: 'Scale AI ML Research Intern' })
    expect(within(card).getByText('Possible duplicate')).toBeVisible()
    await user.click(within(card).getByRole('button', { name: 'Same role — fill blanks' }))

    await waitFor(async () => expect(await repository.listEntries()).toEqual([
      expect.objectContaining({ id: existing.id, url: 'https://scale.example/jobs/1', resumeVariant: 'ML' }),
    ]))
    expect(await screen.findByRole('heading', { name: 'Nothing needs you' })).toBeVisible()
  })

  it('lets you choose the role for an unmatched status update', async () => {
    const user = userEvent.setup()
    const role = createApplication({ company: 'Northwind', title: 'Data Science Intern', submittedDate: '2026-09-20', effort: 'quick' })
    await repository.saveEntry(role)
    localStorage.setItem(KEY_STORAGE, 'paceboard-secret')
    const muse = fakeMuse([batch('1000-0', { statusUpdates: [{
      id: 'event-1', match: { company: 'Unknown Labs', title: 'Analyst', submittedDate: '2026-09-21' },
      status: 'interview', date: '2026-10-02', confidence: 'high', note: 'Superday Oct 9',
    }] })])
    render(<App repository={repository} museClient={muse.client} musePollIntervalMs={0} />)

    await user.click(await screen.findByRole('button', { name: 'Review, 1 pending' }))
    const card = await screen.findByRole('article', { name: 'Interview update' })
    expect(within(card).getByText('Which role?')).toBeVisible()
    expect(within(card).getByRole('button', { name: 'Apply update' })).toBeDisabled()
    await user.click(within(card).getByRole('option', { name: /Northwind/ }))
    await user.click(within(card).getByRole('button', { name: 'Apply update' }))

    await waitFor(async () => {
      const [saved] = await repository.listEntries()
      expect(saved.statusHistory.at(-1)).toEqual({ id: 'event-1', status: 'interview', date: '2026-10-02' })
    })
  })

  it('undoes an automatically added role from Muse activity', async () => {
    const user = userEvent.setup()
    localStorage.setItem(KEY_STORAGE, 'paceboard-secret')
    const muse = fakeMuse([batch('1000-0', { newEntries: [scaleRole] })])
    render(<App repository={repository} museClient={muse.client} musePollIntervalMs={0} />)

    await screen.findByText('Muse: 1 role added')
    await user.click(screen.getByRole('button', { name: /^Review/ }))
    await user.click(screen.getByRole('button', { name: /^Muse/ }))
    await user.click(screen.getByRole('tab', { name: /Activity/ }))
    await user.click(screen.getByRole('button', { name: /Undo Added role/ }))

    await waitFor(async () => expect(await repository.listEntries()).toEqual([]))
    expect((await repository.getMuseData()).items[0]).toMatchObject({ state: 'dismissed', reason: 'undone' })
  })

  it('disconnects and explains when the sync key is rejected', async () => {
    const user = userEvent.setup()
    localStorage.setItem(KEY_STORAGE, 'old-key')
    const muse = fakeMuse()
    muse.state.unauthorized = true
    render(<App repository={repository} museClient={muse.client} musePollIntervalMs={0} />)

    await user.click(await screen.findByRole('button', { name: 'Settings & data' }))
    expect(await screen.findByText(/The sync key was rejected/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Connect Muse' })).toBeVisible()
    expect(localStorage.getItem(KEY_STORAGE)).toBeNull()
  })
})
