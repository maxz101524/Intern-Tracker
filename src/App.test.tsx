import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { TrackerRepository } from './storage/repository'
import { createEntry } from './domain/entries'

describe('Paceboard app', () => {
  let repository: TrackerRepository

  beforeEach(async () => {
    repository = new TrackerRepository(`paceboard-ui-${crypto.randomUUID()}`)
    await repository.reset()
  })

  afterEach(async () => {
    cleanup()
    await repository.destroy()
  })

  it('asks for a weekly goal on first run and opens the dashboard after saving it', async () => {
    const user = userEvent.setup()
    render(<App repository={repository} />)

    expect(await screen.findByRole('heading', { name: 'Set your weekly pace' })).toBeVisible()

    await user.clear(screen.getByLabelText('Applications per week'))
    await user.type(screen.getByLabelText('Applications per week'), '35')
    await user.click(screen.getByRole('button', { name: 'Start tracking' }))

    expect(await screen.findByLabelText('0 of 35 applications')).toBeVisible()
    expect((await repository.getSettings()).weeklyTarget).toBe(35)
  })

  it('logs a quick application from the dashboard and updates the weekly total', async () => {
    const user = userEvent.setup()
    await repository.saveSettings({
      weeklyTarget: 35,
      sources: ['LinkedIn'],
      lastBackupAt: null,
    })
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: 'Log quick application' }))

    expect(await screen.findByLabelText('1 of 35 applications')).toBeVisible()
    expect(await screen.findByText('Application logged')).toBeVisible()
    expect(await repository.listEntries()).toHaveLength(1)
  })

  it('deletes an entry from history and restores it with undo', async () => {
    const user = userEvent.setup()
    await repository.saveSettings({
      weeklyTarget: 20,
      sources: ['Handshake'],
      lastBackupAt: null,
    })
    await repository.saveEntry(
      createEntry({
        submittedAt: new Date().toISOString(),
        quantity: 3,
        type: 'quick',
        source: 'Handshake',
      }),
    )
    render(<App repository={repository} />)

    await user.click(await screen.findByRole('button', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: 'Edit entry' }))
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }))

    expect(await screen.findByText('Entry deleted')).toBeVisible()
    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(0))

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(async () => expect(await repository.listEntries()).toHaveLength(1))
    expect(await screen.findByText('3 applications')).toBeVisible()
  })
})
