import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { createApplication } from './domain/entries'
import { createGmailCandidate } from './domain/gmail'
import type { GmailApiClient } from './gmail/api'
import type { GmailAuthClient, GmailAuthState, GmailAuthStatus } from './gmail/auth'
import type { GmailApiMessage } from './gmail/types'
import { TrackerRepository } from './storage/repository'

describe('Paceboard v2 app', () => {
  let repository: TrackerRepository

  beforeEach(async () => {
    localStorage.clear()
    repository = new TrackerRepository(`paceboard-ui-${crypto.randomUUID()}`)
    await repository.reset()
  })

  afterEach(async () => {
    cleanup()
    await repository.destroy()
  })

  it('asks for a weekly goal on first run and opens Overview', async () => {
    const user = userEvent.setup()
    render(<App repository={repository} />)

    expect(await screen.findByRole('heading', { name: 'Set your weekly pace' })).toBeVisible()
    await user.clear(screen.getByLabelText('Applications per week'))
    await user.type(screen.getByLabelText('Applications per week'), '35')
    await user.click(screen.getByRole('button', { name: 'Start tracking' }))

    expect(await screen.findByLabelText('0 of 35 applications')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Your search, at a glance' })).toBeVisible()
  })

  it('adds a backdated role and keeps the drawer open for repeated entry', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: 'Add application' }))
    await user.type(screen.getByLabelText('Company'), 'Verisk')
    await user.type(screen.getByLabelText('Role title'), 'AI Intern')
    await user.clear(screen.getByLabelText('Submitted'))
    await user.type(screen.getByLabelText('Submitted'), '2026-09-01')
    await user.click(screen.getByRole('button', { name: 'Save & add another' }))

    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(1))
    expect(screen.getByRole('dialog', { name: 'Add application' })).toBeVisible()
    await waitFor(() => expect(screen.getByLabelText('Company')).toHaveValue(''))
    await waitFor(() => expect(screen.getByLabelText('Company')).toHaveFocus())
    expect(screen.getByLabelText('Submitted')).toHaveValue('2026-09-01')

    await user.type(screen.getByLabelText('Company'), 'RSM')
    await user.type(screen.getByLabelText('Role title'), 'Data Science Intern')
    await user.click(screen.getByRole('button', { name: 'Save application' }))

    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add application' })).not.toBeInTheDocument())
  })

  it('updates status without erasing its earlier history', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    const application = createApplication({
      company: 'Cigna', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'targeted',
    })
    await repository.saveEntry(application)
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: 'Applications' }))
    await user.click(await screen.findByRole('button', { name: 'Edit Cigna AI Intern' }))
    await user.selectOptions(screen.getByLabelText('Current status'), 'interview')
    await user.clear(screen.getByLabelText('Status date'))
    await user.type(screen.getByLabelText('Status date'), '2026-09-20')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.getByLabelText('Status for Cigna AI Intern')).toHaveValue('interview'))
    const [updated] = await repository.listEntries()
    expect(updated.statusHistory.map(({ status }) => status)).toEqual(['applied', 'interview'])
  })

  it('deletes one role and restores it with Undo', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    await repository.saveEntry(createApplication({
      company: 'RSM', title: 'Data Science Intern', submittedDate: '2026-09-03', effort: 'quick',
    }))
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: 'Applications' }))
    await user.click(await screen.findByRole('button', { name: 'Edit RSM Data Science Intern' }))
    await user.click(screen.getByRole('button', { name: 'Delete application' }))
    expect(await screen.findByText('Application deleted')).toBeVisible()
    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(0))

    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(1))
    expect(await screen.findByText('RSM')).toBeVisible()
  })

  it('closes the application drawer with Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    render(<App repository={repository} />)

    const trigger = await screen.findByRole('button', { name: 'Add application' })
    await user.click(trigger)
    expect(screen.getByLabelText('Company')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Add application' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('restores an unsaved application draft after closing the drawer', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    render(<App repository={repository} />)
    const trigger = await screen.findByRole('button', { name: 'Add application' })
    await user.click(trigger)
    await user.type(screen.getByLabelText('Company'), 'Draft Company')
    await user.keyboard('{Escape}')
    await user.click(trigger)
    expect(screen.getByLabelText('Company')).toHaveValue('Draft Company')
  })

  it('reviews a Gmail candidate as Quick by default and accepts edited details', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    const candidate = createGmailCandidate({
      messageId: 'gmail-1', threadId: 'thread-1', receivedAt: '2026-09-10T13:30:00.000Z',
      submittedDate: '2026-09-10', sender: 'Acme Recruiting <jobs@acme.com>',
      subject: 'Application received', company: 'Acme', title: 'Data Intern', confidence: 'high',
      matchedRule: 'generic-confirmation', createdAt: '2026-09-10T14:00:00.000Z',
    })
    await repository.saveGmailCandidate(candidate)
    render(<App repository={repository} />)

    const reviewNav = await screen.findByRole('button', { name: 'Review, 1 pending' })
    await user.click(reviewNav)
    expect(screen.getByRole('heading', { name: 'Review Gmail matches' })).toBeVisible()
    expect(screen.getByRole('radio', { name: /Quick/ })).toBeChecked()
    const title = screen.getByLabelText('Role title')
    await user.clear(title)
    await user.type(title, 'Data Science Intern')
    await user.click(screen.getByRole('button', { name: 'Add & next' }))

    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(1))
    expect((await repository.listEntries())[0]).toMatchObject({
      company: 'Acme', title: 'Data Science Intern', effort: 'quick',
      origin: { provider: 'gmail', messageId: 'gmail-1' },
    })
    expect(await screen.findByText('Inbox clear')).toBeVisible()
    expect(await repository.getGmailCandidate('gmail-1')).toMatchObject({ state: 'imported' })
  })

  it('allows Targeted classification, dismissal, and duplicate review warnings', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    const existing = createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-10', effort: 'quick',
    })
    await repository.saveEntry(existing)
    await repository.saveGmailCandidate(createGmailCandidate({
      messageId: 'gmail-2', threadId: 'thread-2', receivedAt: '2026-09-10T13:30:00.000Z',
      submittedDate: '2026-09-10', sender: 'jobs@acme.com', subject: 'Application received',
      company: 'Acme', title: 'ML Intern', confidence: 'medium', matchedRule: 'generic-confirmation',
      createdAt: '2026-09-10T14:00:00.000Z',
    }))
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: 'Review, 1 pending' }))
    expect(screen.getByText(/already has this company, role, and date/i)).toBeVisible()
    await user.click(screen.getByRole('radio', { name: /Targeted/ }))
    expect(screen.getByRole('radio', { name: /Targeted/ })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(await screen.findByText('Inbox clear')).toBeVisible()
    expect(await repository.listEntries()).toEqual([existing])
    expect(await repository.getGmailCandidate('gmail-2')).toMatchObject({ state: 'dismissed' })
    await user.click(screen.getByRole('tab', { name: /Dismissed 1/ }))
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(async () => expect(await repository.getGmailCandidate('gmail-2')).toMatchObject({ state: 'pending' }))
  })

  it('shows Gmail setup guidance without blocking manual tracking', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: 'Settings & data' }))
    expect(screen.getByRole('heading', { name: 'Gmail import' })).toBeVisible()
    expect(screen.getByText(/Google OAuth client ID/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Applications' })).toBeVisible()
  })

  it('connects Gmail, performs the first scan, and surfaces new review work', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    const auth = fakeAuth('disconnected')
    const api = fakeGmailApi({
      listInitialMessageIds: vi.fn().mockResolvedValue(['gmail-3']),
      getMessage: vi.fn().mockResolvedValue(gmailMessage('gmail-3')),
    })
    render(<App repository={repository} gmailAuth={auth} gmailApiFactory={() => api} />)

    await user.click(await screen.findByRole('button', { name: 'Settings & data' }))
    await user.click(screen.getByRole('button', { name: 'Connect Gmail & scan' }))

    expect(await screen.findByText('1 Gmail match is ready to review')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Review, 1 pending' })).toBeVisible()
    expect(api.listInitialMessageIds).toHaveBeenCalledOnce()
    expect((await repository.getGmailSyncState()).accountEmail).toBe('max@example.com')
  })

  it('synchronizes on open when the in-memory authorization is still valid', async () => {
    await readyRepository(repository)
    const auth = fakeAuth('connected')
    const api = fakeGmailApi()
    render(<App repository={repository} gmailAuth={auth} gmailApiFactory={() => api} />)

    await waitFor(() => expect(api.getProfile).toHaveBeenCalledOnce())
    expect(auth.requestToken).not.toHaveBeenCalled()
  })

  it('surfaces a due assessment and completes it without opening the drawer', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    await repository.saveEntry(createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-01', effort: 'quick',
      nextAction: 'Complete assessment', nextActionDueDate: new Date().toISOString().slice(0, 10),
    }))
    render(<App repository={repository} />)

    expect(await screen.findByRole('heading', { name: 'Needs attention' })).toBeVisible()
    expect(screen.getByText('Complete assessment')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(async () => expect((await repository.listEntries())[0].nextActionCompleted).toBe(true))
    await waitFor(() => expect(screen.queryByText('Complete assessment')).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('updates a table status directly and reverses it with Undo', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    await repository.saveEntry(createApplication({
      company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-01', effort: 'quick',
    }))
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Applications' }))

    await user.selectOptions(screen.getByLabelText('Status for Acme ML Intern'), 'online_assessment')
    await waitFor(async () => expect((await repository.listEntries())[0].statusHistory).toHaveLength(2))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await repository.listEntries())[0].statusHistory.map(({ status }) => status)).toEqual(['applied']))
  })

  it('bulk-updates selected applications and reverses the whole change', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    for (const [company, title] of [['Acme', 'ML Intern'], ['Beta', 'DS Intern']]) {
      await repository.saveEntry(createApplication({ company, title, submittedDate: '2026-09-01', effort: 'quick' }))
    }
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Applications' }))
    await user.click(screen.getByLabelText('Select all shown applications'))
    const bulk = screen.getByRole('region', { name: 'Bulk update applications' })
    await user.selectOptions(within(bulk).getByLabelText('Status'), 'interview')

    await waitFor(async () => expect((await repository.listEntries()).every((entry) => entry.statusHistory.at(-1)?.status === 'interview')).toBe(true))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await repository.listEntries()).every((entry) => entry.statusHistory.length === 1)).toBe(true))
  })

  it('opens an exact assessment ledger filter from the pipeline count', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    const assessment = createApplication({ company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-01', effort: 'quick' })
    await repository.saveEntry({ ...assessment, statusHistory: [...assessment.statusHistory, { id: 'assessment', status: 'online_assessment', date: '2026-09-08' }] })
    await repository.saveEntry(createApplication({ company: 'Beta', title: 'DS Intern', submittedDate: '2026-09-02', effort: 'quick' }))
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: /Online assessment\s+1/i }))
    expect(await screen.findByText('online assessment', { selector: '.active-filters span' })).toBeVisible()
    expect(screen.getByText('1', { selector: '.ledger-summary strong' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Acme' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Beta' })).not.toBeInTheDocument()
  })

  it('accepts a Gmail status suggestion into the matched history exactly once', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    const application = createApplication({ company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-01', effort: 'quick' })
    await repository.saveEntry(application)
    const candidate = createGmailCandidate({
      messageId: 'status-1', threadId: 'thread-status-1', receivedAt: '2026-09-10T13:30:00.000Z', submittedDate: '2026-09-10',
      sender: 'Acme <jobs@acme.com>', subject: 'Assessment invitation for ML Intern at Acme', company: 'Acme', title: 'ML Intern',
      confidence: 'high', matchedRule: 'generic-assessment', kind: 'status', suggestedStatus: 'online_assessment',
      eventDate: '2026-09-10', matchedEntryIds: [application.id], supportingSnippet: 'Please complete the assessment.',
    })
    await repository.saveGmailCandidate(candidate)
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Review, 1 pending' }))
    await user.click(screen.getByRole('button', { name: 'Accept' }))

    await waitFor(async () => expect((await repository.listEntries())[0].statusHistory).toHaveLength(2))
    const [updated] = await repository.listEntries()
    expect(updated.statusHistory[1]).toMatchObject({ status: 'online_assessment', origin: { messageId: 'status-1' } })
    expect(await repository.getGmailCandidate('status-1')).toMatchObject({ state: 'imported', linkedEntryId: application.id })
  })

  it('links a duplicate confirmation to the existing application without adding another', async () => {
    const user = userEvent.setup()
    await readyRepository(repository)
    const existing = createApplication({ company: 'Acme', title: 'ML Intern', submittedDate: '2026-09-10', effort: 'quick' })
    await repository.saveEntry(existing)
    const candidate = createGmailCandidate({
      messageId: 'duplicate-1', threadId: 'thread-duplicate-1', receivedAt: '2026-09-10T13:30:00.000Z',
      submittedDate: '2026-09-10', sender: 'Acme <jobs@acme.com>', subject: 'Application received',
      company: 'Acme', title: 'ML Intern', confidence: 'high', matchedRule: 'generic-confirmation',
    })
    await repository.saveGmailCandidate(candidate)
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Review, 1 pending' }))
    await user.click(screen.getByRole('button', { name: 'Link to existing' }))

    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(1))
    expect((await repository.listEntries())[0].origin).toEqual({ provider: 'gmail', messageId: 'duplicate-1' })
    expect(await repository.getGmailCandidate('duplicate-1')).toMatchObject({ state: 'imported', linkedEntryId: existing.id })
  })
})

async function readyRepository(repository: TrackerRepository) {
  await repository.saveSettings({
    weeklyTarget: 35,
    sources: ['LinkedIn', 'Company site', 'Career fair', 'Referral'],
    lastBackupAt: null,
  })
}

function fakeAuth(initialStatus: GmailAuthStatus): GmailAuthClient {
  let state: GmailAuthState = { status: initialStatus }
  let token = initialStatus === 'connected' ? 'token' : null
  const listeners = new Set<(next: GmailAuthState) => void>()
  const update = (next: GmailAuthState) => {
    state = next
    for (const listener of listeners) listener(next)
  }
  return {
    requestToken: vi.fn(async () => {
      token = 'token'
      update({ status: 'connected', expiresAt: Date.now() + 3_600_000 })
      return token
    }),
    getValidToken: vi.fn(() => token),
    getState: () => state,
    invalidate: () => { token = null; update({ status: 'expired' }) },
    disconnect: vi.fn(async () => { token = null; update({ status: 'disconnected' }) }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}

function fakeGmailApi(overrides: Partial<GmailApiClient> = {}): GmailApiClient {
  return {
    getProfile: vi.fn().mockResolvedValue({ emailAddress: 'max@example.com', historyId: '500' }),
    listInitialMessageIds: vi.fn().mockResolvedValue([]),
    listHistoryMessageIds: vi.fn().mockResolvedValue({ messageIds: [], historyId: '500' }),
    getMessage: vi.fn(),
    ...overrides,
  }
}

function gmailMessage(id: string): GmailApiMessage {
  const text = 'Thank you for applying to Data Science Intern at Acme.'
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    id, threadId: `thread-${id}`, internalDate: '1789047000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Acme Recruiting <jobs@acme.com>' },
        { name: 'Subject', value: 'Thank you for applying' },
      ],
      body: { data: btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') },
    },
  }
}
