import { describe, expect, it } from 'vitest'
import { createApplication } from './entries'
import { getAttentionGroups } from './attention'

describe('next-action attention groups', () => {
  it('orders incomplete deadlines into overdue, today, and upcoming', () => {
    const make = (id: string, due: string, completed = false) => createApplication({
      id, company: id, title: 'Intern', submittedDate: '2026-09-01', effort: 'quick',
      nextAction: 'Complete assessment', nextActionDueDate: due, nextActionCompleted: completed,
    })
    const groups = getAttentionGroups([
      make('later', '2026-09-15'), make('overdue', '2026-09-08'),
      make('today', '2026-09-10'), make('done', '2026-09-07', true), make('sooner', '2026-09-12'),
    ], '2026-09-10')

    expect(groups.overdue.map(({ id }) => id)).toEqual(['overdue'])
    expect(groups.today.map(({ id }) => id)).toEqual(['today'])
    expect(groups.upcoming.map(({ id }) => id)).toEqual(['sooner', 'later'])
  })

  it('keeps actions without a due date visible and excludes blank or completed actions', () => {
    const make = (id: string, company: string, nextAction: string, nextActionCompleted = false) => createApplication({
      id, company, title: 'Intern', submittedDate: '2026-09-01', effort: 'quick', nextAction, nextActionCompleted,
    })
    const groups = getAttentionGroups([
      make('z', 'Zoom', 'Prepare interview'), make('a', 'Acme', 'Write follow-up'),
      make('empty', 'Blank', '   '), make('done', 'Done', 'Send note', true),
    ], '2026-09-10')

    expect(groups.noDate.map(({ id }) => id)).toEqual(['a', 'z'])
    expect(groups.overdue).toEqual([])
    expect(groups.today).toEqual([])
    expect(groups.upcoming).toEqual([])
  })
})
