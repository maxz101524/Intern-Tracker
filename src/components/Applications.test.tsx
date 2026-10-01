import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApplication } from '../domain/entries'
import { appendStatus, parseLocalDate, todayDate } from '../domain/status'
import type { ApplicationEntry, AppSettings } from '../domain/types'
import { EMPTY_FILTERS } from '../domain/views'
import { Applications } from './Applications'
import { ApplicationTable } from './ApplicationTable'

const today = todayDate()
const settings: AppSettings = { weeklyTarget: 35, sources: ['Referral', 'Company site'], lastBackupAt: null }

function role(company: string, status: 'applied' | 'interview' = 'applied'): ApplicationEntry {
  const entry = createApplication({ company, title: 'Data Intern', submittedDate: today, effort: 'quick', source: 'Referral' })
  return status === 'applied' ? entry : appendStatus(entry, status, today)
}

function props(entries: ApplicationEntry[]) {
  return { entries, settings, onAdd: vi.fn(), onEdit: vi.fn(), onUpdateEntries: vi.fn().mockResolvedValue(undefined), onSaveSettings: vi.fn().mockResolvedValue(undefined) }
}

afterEach(cleanup)

describe('application discovery and batch changes', () => {
  it('clears the selection when a search changes and updates only newly selected matches', async () => {
    const user = userEvent.setup()
    const acme = role('Acme')
    const beta = role('Beta')
    const callbacks = props([acme, beta])
    render(<Applications {...callbacks} />)
    await user.click(screen.getByLabelText('Select all shown applications'))
    expect(screen.getByRole('region', { name: 'Bulk update applications' })).toHaveTextContent('2 selected')

    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'Beta')
    expect(screen.queryByRole('region', { name: 'Bulk update applications' })).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Select Beta Data Intern'))
    await user.selectOptions(within(screen.getByRole('region', { name: 'Bulk update applications' })).getByLabelText('Status'), 'interview')

    await waitFor(() => expect(callbacks.onUpdateEntries).toHaveBeenCalledOnce())
    expect(callbacks.onUpdateEntries.mock.calls[0][0].map((entry: ApplicationEntry) => entry.id)).toEqual([beta.id])
    expect(callbacks.onUpdateEntries.mock.calls[0][1]).toEqual([beta])
  })

  it('excludes selected roles that stop matching after their data changes', async () => {
    const user = userEvent.setup()
    const acme = role('Acme', 'interview')
    const beta = role('Beta', 'interview')
    const callbacks = props([acme, beta])
    const { rerender } = render(<Applications {...callbacks} />)
    await user.selectOptions(screen.getByLabelText('Status'), 'interview')
    await user.click(screen.getByLabelText('Select all shown applications'))

    rerender(<Applications {...callbacks} entries={[appendStatus(acme, 'rejected', today), beta]} />)
    expect(screen.queryByRole('button', { name: 'Acme' })).not.toBeInTheDocument()
    const bulk = screen.getByRole('region', { name: 'Bulk update applications' })
    expect(bulk).toHaveTextContent('1 selected')
    await user.selectOptions(within(bulk).getByLabelText('Effort'), 'targeted')
    await waitFor(() => expect(callbacks.onUpdateEntries).toHaveBeenCalledOnce())
    expect(callbacks.onUpdateEntries.mock.calls[0][0].map((entry: ApplicationEntry) => entry.id)).toEqual([beta.id])
  })

  it('shows a mixed select-all checkbox and locks a batch while it saves', async () => {
    const user = userEvent.setup()
    const callbacks = props([role('Acme'), role('Beta')])
    let finishSave!: () => void
    callbacks.onUpdateEntries.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve }))
    render(<Applications {...callbacks} />)
    await user.click(screen.getByLabelText('Select Acme Data Intern'))
    const selectAll = screen.getByLabelText('Select all shown applications')
    expect(selectAll).toBePartiallyChecked()
    expect(selectAll).toHaveAttribute('aria-checked', 'mixed')
    await user.click(selectAll)
    expect(selectAll).toBeChecked()
    const bulk = screen.getByRole('region', { name: 'Bulk update applications' })
    await user.selectOptions(within(bulk).getByLabelText('Status'), 'interview')
    expect(within(bulk).getByLabelText('Effort')).toBeDisabled()
    expect(screen.getByLabelText('Select Acme Data Intern')).toBeDisabled()
    finishSave()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Bulk update applications' })).not.toBeInTheDocument())
  })

  it('keeps the selection available when a batch fails', async () => {
    const user = userEvent.setup()
    const callbacks = props([role('Acme')])
    callbacks.onUpdateEntries.mockRejectedValueOnce(new Error('Local data could not be saved.'))
    render(<Applications {...callbacks} />)
    await user.click(screen.getByLabelText('Select Acme Data Intern'))
    await user.selectOptions(within(screen.getByRole('region', { name: 'Bulk update applications' })).getByLabelText('Status'), 'interview')
    expect(await screen.findByRole('alert')).toHaveTextContent('Local data could not be saved.')
    expect(screen.getByLabelText('Select Acme Data Intern')).toBeChecked()
    expect(within(screen.getByRole('region', { name: 'Bulk update applications' })).getByLabelText('Status')).toBeEnabled()
  })

  it('reports a failed row status save, permits retry, and serializes other ledger changes', async () => {
    const user = userEvent.setup()
    const acme = role('Acme')
    const callbacks = props([acme, role('Beta')])
    let failSave!: (reason: Error) => void
    callbacks.onUpdateEntries.mockImplementationOnce(() => new Promise<void>((_, reject) => { failSave = reject }))
    render(<Applications {...callbacks} />)
    await user.click(screen.getByLabelText('Select all shown applications'))

    await user.selectOptions(screen.getByLabelText('Status for Acme Data Intern'), 'interview')
    const acmeRow = screen.getByRole('button', { name: 'Acme' }).closest('tr')!
    expect(acmeRow).toHaveAttribute('aria-busy', 'true')
    expect(within(acmeRow).getByRole('status')).toHaveTextContent('Saving…')
    expect(screen.getByLabelText('Status for Beta Data Intern')).toBeDisabled()
    expect(within(screen.getByRole('region', { name: 'Bulk update applications' })).getByLabelText('Status')).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Status for Beta Data Intern'), 'offer')
    expect(callbacks.onUpdateEntries).toHaveBeenCalledOnce()

    failSave(new Error('Status could not be saved. Please retry.'))
    expect(await within(acmeRow).findByRole('alert')).toHaveTextContent('Status could not be saved. Please retry.')
    expect(screen.getByLabelText('Status for Acme Data Intern')).toHaveValue('applied')
    expect(screen.getByLabelText('Status for Beta Data Intern')).toBeEnabled()

    await user.selectOptions(screen.getByLabelText('Status for Acme Data Intern'), 'interview')
    await waitFor(() => expect(callbacks.onUpdateEntries).toHaveBeenCalledTimes(2))
    expect(within(acmeRow).queryByRole('alert')).not.toBeInTheDocument()
    expect(callbacks.onUpdateEntries.mock.calls[1][0][0].statusHistory.map(({ status }: { status: string }) => status)).toEqual(['applied', 'interview'])
    expect(callbacks.onUpdateEntries.mock.calls[1][1]).toEqual([acme])
  })

  it('removes one filter without clearing the others and announces the result count', async () => {
    const user = userEvent.setup()
    render(<Applications {...props([role('Acme', 'interview'), role('Beta')])} />)
    await user.selectOptions(screen.getByLabelText('Status'), 'interview')
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'Acme')
    await user.click(screen.getByRole('button', { name: 'Remove Search: Acme filter' }))
    expect(screen.getByLabelText('Status')).toHaveValue('interview')
    expect(screen.getByRole('searchbox', { name: 'Search applications' })).toHaveValue('')
    expect(screen.getByRole('status')).toHaveTextContent('1 opportunity shown')
    await user.click(screen.getByRole('button', { name: 'Remove interview filter' }))
    expect(screen.getByRole('status')).toHaveTextContent('2 opportunities shown')
    expect(screen.getByRole('button', { name: 'All applications' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('distinguishes a first application from a filtered empty view and supplies the right action', async () => {
    const user = userEvent.setup()
    const callbacks = props([])
    const { rerender } = render(<Applications {...callbacks} />)
    await user.click(screen.getByRole('button', { name: 'Add your first application' }))
    expect(callbacks.onAdd).toHaveBeenCalledOnce()
    rerender(<Applications {...callbacks} entries={[role('Acme')]} />)
    await user.type(screen.getByRole('searchbox', { name: 'Search applications' }), 'Missing company')
    expect(screen.getByText('No opportunities match this view.')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByRole('button', { name: 'Acme' })).toBeVisible()
  })

  it('clears saved-view identity when changing presets and toggles the active preset off', async () => {
    const user = userEvent.setup()
    const savedSettings = { ...settings, savedViews: [{ id: 'interviews', name: 'Interviews', filters: { ...EMPTY_FILTERS, status: 'interview' as const } }] }
    render(<Applications {...props([role('Acme', 'interview'), role('Beta')])} settings={savedSettings} />)
    await user.selectOptions(screen.getByLabelText('Saved views'), 'interviews')
    expect(screen.getByRole('button', { name: 'Rename' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Awaiting response' }))
    expect(screen.getByLabelText('Saved views')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Beta' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Acme' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Awaiting response' }))
    expect(screen.getByRole('button', { name: 'Acme' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'All applications' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('focuses search with slash only in the visible application workspace', async () => {
    const user = userEvent.setup()
    const callbacks = props([role('Acme')])
    const { rerender } = render(<Applications {...callbacks} />)
    await user.keyboard('/')
    expect(screen.getByRole('searchbox', { name: 'Search applications' })).toHaveFocus()
    await user.keyboard('/')
    expect(screen.getByRole('searchbox', { name: 'Search applications' })).toHaveValue('/')
    rerender(<div hidden><Applications {...callbacks} /></div>)
    await user.keyboard('/')
    expect(document.activeElement).toBe(document.body)
  })
})

describe('application deadline context', () => {
  it('distinguishes overdue, due today, and completed next actions', () => {
    const yesterday = parseLocalDate(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const entries = [
      { ...role('Acme'), nextAction: 'Send follow-up', nextActionDueDate: todayDate(yesterday) },
      { ...role('Beta'), nextAction: 'Finish assessment', nextActionDueDate: today },
      { ...role('Complete'), nextAction: 'Prepare for call', nextActionDueDate: todayDate(yesterday), nextActionCompleted: true },
    ]
    render(<ApplicationTable entries={entries} onEdit={vi.fn()} visibleColumns={['nextAction']} />)
    const acme = screen.getByRole('button', { name: 'Acme' }).closest('tr')!
    const beta = screen.getByRole('button', { name: 'Beta' }).closest('tr')!
    const complete = screen.getByRole('button', { name: 'Complete' }).closest('tr')!
    expect(within(acme).getByText(/Overdue/)).toBeVisible()
    expect(within(beta).getByText('Due today')).toBeVisible()
    expect(within(complete).getByText('Completed')).toBeVisible()
    expect(within(complete).queryByText(/Overdue/)).not.toBeInTheDocument()
  })
})
