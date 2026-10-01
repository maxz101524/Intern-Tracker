import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { createApplication } from './domain/entries'
import { TrackerRepository } from './storage/repository'

describe('Workspace search and keyboard navigation', () => {
  let repository: TrackerRepository

  beforeEach(async () => {
    localStorage.clear()
    repository = new TrackerRepository(`paceboard-shortcuts-${crypto.randomUUID()}`)
    await repository.reset()
    await repository.saveSettings({
      weeklyTarget: 35,
      sources: ['Company site'],
      lastBackupAt: null,
    })
  })

  afterEach(async () => {
    cleanup()
    await repository.destroy()
  })

  it('opens with Command K from an input and returns focus without losing the input value', async () => {
    const user = userEvent.setup()
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Applications' }))
    const ledgerSearch = screen.getByRole('searchbox', { name: 'Search applications' })
    await user.type(ledgerSearch, 'existing filter')

    await user.keyboard('{Meta>}k{/Meta}')

    expect(screen.getByRole('dialog', { name: 'Search workspace' })).toBeVisible()
    const commandInput = screen.getByRole('combobox', { name: 'Find an application or action' })
    const closeSearch = screen.getByRole('button', { name: 'Close workspace search' })
    expect(commandInput).toHaveFocus()
    await user.tab()
    expect(closeSearch).toHaveFocus()
    await user.tab()
    expect(commandInput).toHaveFocus()
    await user.tab({ shift: true })
    expect(closeSearch).toHaveFocus()
    await user.tab({ shift: true })
    expect(commandInput).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(ledgerSearch).toHaveFocus()
    expect(ledgerSearch).toHaveValue('existing filter')
  })

  it('finds company and role names, opens the existing application, and preserves drawer focus', async () => {
    const user = userEvent.setup()
    await repository.saveEntry(createApplication({ company: 'Verisk', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick' }))
    await repository.saveEntry(createApplication({ company: 'RSM', title: 'Data Science Intern', submittedDate: '2026-09-03', effort: 'targeted' }))
    render(<App repository={repository} />)
    const searchTrigger = await screen.findByRole('button', { name: 'Search workspace' })
    await user.click(searchTrigger)
    const menu = screen.getByRole('dialog', { name: 'Search workspace' })
    const query = within(menu).getByRole('combobox', { name: 'Find an application or action' })
    await user.type(query, 'vErIsK')
    expect(within(menu).getAllByRole('option')).toHaveLength(1)
    expect(within(menu).getByRole('option', { name: /Verisk AI Intern/ })).toBeVisible()
    await user.clear(query)
    await user.type(query, 'AI Intern')
    await user.click(within(menu).getByRole('option', { name: /Verisk AI Intern/ }))

    expect(screen.getByRole('dialog', { name: 'Verisk — AI Intern' })).toBeVisible()
    expect(screen.getByLabelText('Company')).toHaveFocus()
    expect(screen.getByLabelText('Role title')).toHaveValue('AI Intern')
    await user.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByRole('dialog', { name: 'Search workspace' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByLabelText('Company')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(searchTrigger).toHaveFocus()
    expect(await repository.listEntries()).toHaveLength(2)
  })

  it('navigates actions with arrow keys and Enter', async () => {
    const user = userEvent.setup()
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Search workspace' }))
    const menu = screen.getByRole('dialog', { name: 'Search workspace' })
    expect(within(menu).getByRole('option', { name: /Add application/ })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('option', { name: /Applications Search and manage your roles/ })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Search applications' })).toBeVisible()
  })

  it('opens the complete filtered ledger when search has more than six application matches', async () => {
    const user = userEvent.setup()
    await Promise.all(Array.from({ length: 8 }, (_, index) => repository.saveEntry(createApplication({
      company: 'Acme', title: `Data Intern ${index + 1}`, submittedDate: '2026-09-03', effort: 'quick',
    }))))
    await repository.saveEntry(createApplication({ company: 'RSM', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick' }))
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Search workspace' }))
    const menu = screen.getByRole('dialog', { name: 'Search workspace' })
    await user.type(within(menu).getByRole('combobox', { name: 'Find an application or action' }), 'Acme')
    expect(within(menu).getAllByRole('option')).toHaveLength(7)

    await user.click(within(menu).getByRole('option', { name: /View all 8 matches/ }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Applications', level: 1 })).toBeVisible()
    expect(screen.getByRole('searchbox', { name: 'Search applications' })).toHaveValue('Acme')
    expect(screen.getAllByRole('button', { name: /^Edit Acme Data Intern / })).toHaveLength(8)
    expect(screen.queryByRole('button', { name: 'Edit RSM AI Intern' })).not.toBeInTheDocument()
  })

  it('uses slash for ledger search on Applications without opening workspace search', async () => {
    const user = userEvent.setup()
    render(<App repository={repository} />)
    await user.click(await screen.findByRole('button', { name: 'Applications' }))

    await user.keyboard('/')

    const ledgerSearch = screen.getByRole('searchbox', { name: 'Search applications' })
    expect(ledgerSearch).toHaveFocus()
    expect(ledgerSearch).toHaveValue('')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.type(ledgerSearch, 'Verisk')
    expect(ledgerSearch).toHaveValue('Verisk')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
