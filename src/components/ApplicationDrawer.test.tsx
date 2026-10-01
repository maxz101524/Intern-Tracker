import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApplication } from '../domain/entries'
import { ApplicationDrawer } from './ApplicationDrawer'

const defaults = { entries: [], sources: [], resumeVariants: [] }

describe('Application drawer safeguards', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => cleanup())

  it.each(['Company', 'Role title', 'Submitted'])('validates %s before saving and adding another', async (missingField) => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ApplicationDrawer {...defaults} onClose={vi.fn()} onSave={onSave} />)
    await user.type(screen.getByLabelText('Company'), 'Verisk')
    await user.type(screen.getByLabelText('Role title'), 'AI Intern')
    await user.clear(screen.getByLabelText(missingField))

    await user.click(screen.getByRole('button', { name: 'Save & add another' }))

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByLabelText(missingField)).toBeInvalid()
  })

  it('opens invalid optional fields and applies the same validation to the save shortcut', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ApplicationDrawer {...defaults} onClose={vi.fn()} onSave={onSave} />)
    await user.type(screen.getByLabelText('Company'), 'Verisk')
    await user.type(screen.getByLabelText('Role title'), 'AI Intern')
    const details = screen.getByText('Resume, listing, and notes').closest('details')!
    await user.click(screen.getByText('Resume, listing, and notes'))
    await user.type(screen.getByLabelText('Job URL'), 'invalid-url')
    details.open = false

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(onSave).not.toHaveBeenCalled()
    expect(details.open).toBe(true)
    expect(screen.getByLabelText('Job URL')).toBeInvalid()
    await user.click(screen.getByRole('button', { name: 'Save & add another' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('locks changes and duplicate submissions while a save is pending', async () => {
    const user = userEvent.setup()
    let finishSave!: () => void
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve }))
    const onClose = vi.fn()
    render(<ApplicationDrawer {...defaults} onClose={onClose} onSave={onSave} />)
    await user.type(screen.getByLabelText('Company'), 'Verisk')
    await user.type(screen.getByLabelText('Role title'), 'AI Intern')
    await user.click(screen.getByRole('button', { name: 'Save application' }))

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByLabelText('Company')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Close application drawer' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save & add another' })).toBeDisabled()
    fireEvent.submit(screen.getByLabelText('Company').closest('form')!)
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    finishSave()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(localStorage.getItem('paceboard-application-draft:new')).toBeNull()
  })

  it('reports deletion failures and leaves the application available to retry', async () => {
    const user = userEvent.setup()
    const entry = createApplication({ company: 'Cigna', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick' })
    const onDelete = vi.fn().mockRejectedValue(new Error('Storage is unavailable. Try again.'))
    render(<ApplicationDrawer {...defaults} entry={entry} onClose={vi.fn()} onSave={vi.fn()} onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: 'Delete application' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Storage is unavailable. Try again.')
    expect(screen.getByRole('button', { name: 'Delete application' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    expect(screen.getByLabelText('Company')).toHaveValue('Cigna')
  })

  it('updates the current status when corrected history dates change its order', async () => {
    const user = userEvent.setup()
    const entry = createApplication({
      company: 'Cigna', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick',
      statusHistory: [
        { id: 'applied', status: 'applied', date: '2026-09-03' },
        { id: 'screen', status: 'recruiter_screen', date: '2026-09-10' },
        { id: 'interview', status: 'interview', date: '2026-09-20' },
      ],
    })
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(<ApplicationDrawer {...defaults} entry={entry} onClose={vi.fn()} onSave={onSave} />)

    fireEvent.change(screen.getByLabelText('Status event 3 date'), { target: { value: '' } })
    expect(screen.getByLabelText('Status event 1')).toHaveValue('applied')
    expect(screen.getByLabelText('Status event 2 date')).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Status event 2 date'), { target: { value: '2026-09-08' } })
    expect(screen.getByLabelText('Current status')).toHaveValue('recruiter_screen')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    const saved = onSave.mock.calls[0][0]
    expect(saved.statusHistory.map(({ status }: { status: string }) => status)).toEqual(['applied', 'interview', 'recruiter_screen'])
    expect(saved.statusHistory).toHaveLength(3)
  })

  it('keeps a closed disclosure summary in the keyboard focus loop', () => {
    render(<ApplicationDrawer {...defaults} onClose={vi.fn()} onSave={vi.fn()} />)
    screen.getByLabelText('Company').closest('fieldset')!.disabled = true
    screen.getByRole<HTMLButtonElement>('button', { name: 'Save application' }).disabled = true
    screen.getByRole<HTMLButtonElement>('button', { name: 'Save & add another' }).disabled = true
    const summary = screen.getByText('Resume, listing, and notes').closest('summary')!
    summary.focus()
    expect(summary).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Tab' })

    expect(screen.getByRole('button', { name: 'Close application drawer' })).toHaveFocus()
  })

  it('excludes hidden controls when wrapping keyboard focus', () => {
    render(<ApplicationDrawer {...defaults} onClose={vi.fn()} onSave={vi.fn()} />)
    const form = screen.getByLabelText('Company').closest('form')!
    const hiddenInput = document.createElement('input')
    hiddenInput.type = 'hidden'
    hiddenInput.tabIndex = 0
    const hiddenButton = document.createElement('button')
    hiddenButton.style.display = 'none'
    form.append(hiddenInput, hiddenButton)
    screen.getByRole('button', { name: 'Save application' }).focus()

    fireEvent.keyDown(window, { key: 'Tab' })

    expect(screen.getByRole('button', { name: 'Close application drawer' })).toHaveFocus()
  })

  it('restores an unsaved draft and lets the user discard it', async () => {
    const user = userEvent.setup()
    const props = { ...defaults, onClose: vi.fn(), onSave: vi.fn() }
    const first = render(<ApplicationDrawer {...props} />)
    await user.type(screen.getByLabelText('Company'), 'Verisk')
    await user.type(screen.getByLabelText('Role title'), 'AI Intern')
    first.unmount()
    render(<ApplicationDrawer {...props} />)

    expect(screen.getByLabelText('Company')).toHaveValue('Verisk')
    expect(screen.getByRole('status')).toHaveTextContent('Your unsaved draft was restored.')
    await user.click(screen.getByRole('button', { name: 'Discard draft' }))

    expect(screen.getByLabelText('Company')).toHaveValue('')
    expect(screen.getByLabelText('Role title')).toHaveValue('')
    expect(screen.getByLabelText('Company')).toHaveFocus()
    expect(localStorage.getItem('paceboard-application-draft:new')).toBeNull()
  })

  it('ignores malformed saved drafts', () => {
    localStorage.setItem('paceboard-application-draft:new', JSON.stringify({ company: 'Incomplete draft' }))
    render(<ApplicationDrawer {...defaults} onClose={vi.fn()} onSave={vi.fn()} />)

    expect(screen.getByLabelText('Company')).toHaveValue('')
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})
