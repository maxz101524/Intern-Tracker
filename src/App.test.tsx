import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { createApplication } from './domain/entries'
import { TrackerRepository } from './storage/repository'

describe('Paceboard v2 app', () => {
  let repository: TrackerRepository

  beforeEach(async () => {
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
    expect(screen.getByLabelText('Company')).toHaveValue('')
    expect(screen.getByLabelText('Company')).toHaveFocus()
    expect(screen.getByLabelText('Submitted')).toHaveValue('2026-09-01')

    await user.type(screen.getByLabelText('Company'), 'RSM')
    await user.type(screen.getByLabelText('Role title'), 'Data Science Intern')
    await user.click(screen.getByRole('button', { name: 'Save application' }))

    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(2))
    expect(screen.queryByRole('dialog', { name: 'Add application' })).not.toBeInTheDocument()
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

    expect(await screen.findByText('Interview', { selector: '.status-badge' })).toBeVisible()
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

    await user.click(screen.getByRole('button', { name: 'Undo' }))
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
})

async function readyRepository(repository: TrackerRepository) {
  await repository.saveSettings({
    weeklyTarget: 35,
    sources: ['LinkedIn', 'Company site', 'Career fair', 'Referral'],
    lastBackupAt: null,
  })
}
