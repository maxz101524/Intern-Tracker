import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApplication } from '../domain/entries'
import { appendStatus, todayDate } from '../domain/status'
import type { ApplicationEntry } from '../domain/types'
import { Overview } from './Overview'

afterEach(cleanup)

function makeAction(id: string, offset?: number): ApplicationEntry {
  const date = new Date()
  date.setDate(date.getDate() + (offset ?? 0))
  return createApplication({
    id, company: id, title: 'ML Intern', submittedDate: todayDate(), effort: 'quick',
    nextAction: `Next step ${id}`, nextActionDueDate: offset === undefined ? undefined : todayDate(date),
  })
}

function renderOverview(entries: ApplicationEntry[], onUpdateEntry = vi.fn<(next: ApplicationEntry) => Promise<void>>().mockResolvedValue(undefined), reviewCount = 0) {
  const onOpenApplications = vi.fn()
  const onAdd = vi.fn()
  const onOpenReview = vi.fn()
  render(<Overview entries={entries} settings={{ weeklyTarget: 20, sources: [], lastBackupAt: null }} reviewCount={reviewCount} onOpenReview={onOpenReview} onAdd={onAdd} onEdit={vi.fn()} onUpdateEntry={onUpdateEntry} onOpenApplications={onOpenApplications} />)
  return { onOpenApplications, onAdd, onUpdateEntry, onOpenReview }
}

describe('Overview next actions and ledger navigation', () => {
  it('reveals all actions, including actions without a date, while keeping the default list short', async () => {
    const user = userEvent.setup()
    renderOverview([makeAction('undated'), makeAction('later', 12), makeAction('soon', 4), makeAction('today', 0), makeAction('older', -3), makeAction('overdue', -1)])
    const focus = within(screen.getByRole('region', { name: 'Needs attention' }))

    expect(focus.getAllByRole('article')).toHaveLength(5)
    expect(focus.getAllByRole('article')[0]).toHaveAccessibleName('Next step older for older')
    expect(focus.queryByText('Next step undated')).not.toBeInTheDocument()
    await user.click(focus.getByRole('button', { name: 'Show all actions' }))
    expect(focus.getAllByRole('article')).toHaveLength(6)
    expect(focus.getByText('Next step undated')).toBeVisible()

    await user.click(focus.getByRole('button', { name: 'Due soon' }))
    expect(focus.getAllByRole('article')).toHaveLength(4)
    expect(focus.queryByText('Next step later')).not.toBeInTheDocument()
    expect(focus.queryByText('Next step undated')).not.toBeInTheDocument()
    await user.click(focus.getByRole('button', { name: /^No date/ }))
    expect(focus.getAllByRole('article')).toHaveLength(1)
    expect(focus.getByText('Next step undated')).toBeVisible()
  })

  it('prevents duplicate updates while saving and keeps a failed action available to retry', async () => {
    const user = userEvent.setup()
    let rejectUpdate: (reason: Error) => void = () => undefined
    const onUpdateEntry = vi.fn<() => Promise<void>>().mockImplementation(() => new Promise<void>((_resolve, reject) => { rejectUpdate = reject }))
    const entry = makeAction('assessment', 0)
    renderOverview([entry], onUpdateEntry)
    const focus = within(screen.getByRole('region', { name: 'Needs attention' }))

    await user.click(focus.getByRole('button', { name: 'Done' }))
    expect(focus.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(focus.getByRole('button', { name: 'Snooze' })).toBeDisabled()
    expect(focus.getByRole('button', { name: 'Open' })).toBeDisabled()
    expect(onUpdateEntry).toHaveBeenCalledOnce()
    await act(async () => rejectUpdate(new Error('Unable to save. Try again.')))

    expect(focus.getByRole('alert')).toHaveTextContent('Unable to save. Try again.')
    expect(focus.getByText('Next step assessment')).toBeVisible()
    expect(focus.getByRole('button', { name: 'Done' })).toBeEnabled()
    onUpdateEntry.mockResolvedValue(undefined)
    await user.click(focus.getByRole('button', { name: 'Done' }))
    expect(onUpdateEntry).toHaveBeenCalledTimes(2)
    expect(focus.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('opens the exact submitted date from the daily chart and offers a useful empty state', async () => {
    const user = userEvent.setup()
    const { onOpenApplications, onAdd } = renderOverview([])

    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'You’re clear for now' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Add your first application' }))
    expect(onAdd).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: /0 applications, today$/ }))
    expect(onOpenApplications).toHaveBeenCalledWith({ fromDate: todayDate(), toDate: todayDate() })
  })
})

describe('Overview employer steps and responses', () => {
  it('lists assessments and interviews as actions and records Done on the role', async () => {
    const user = userEvent.setup()
    const submitted = todayDate(new Date(Date.now() - 6 * 86_400_000))
    const interview = appendStatus(createApplication({ id: 'int', company: 'Northwind', title: 'ML Intern', submittedDate: submitted, effort: 'quick' }), 'interview', todayDate())
    const { onUpdateEntry, onOpenReview } = renderOverview([interview], undefined, 2)
    const focus = within(screen.getByRole('region', { name: 'Needs attention' }))

    expect(focus.getByRole('article', { name: 'Prepare for the interview for Northwind' })).toBeVisible()
    await user.click(focus.getByRole('button', { name: /2 updates need a decision/ }))
    expect(onOpenReview).toHaveBeenCalledOnce()
    await user.click(focus.getByRole('button', { name: 'Done' }))
    expect(onUpdateEntry).toHaveBeenCalledWith(
      expect.objectContaining({ nextAction: 'Prepare for the interview', nextActionCompleted: true }),
      interview,
      'Prepare for the interview marked done',
    )
    expect(screen.getByRole('region', { name: 'Latest responses' })).toHaveTextContent('Northwind')
  })
})
