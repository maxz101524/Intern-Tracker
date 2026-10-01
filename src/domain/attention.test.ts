import { describe, expect, it } from 'vitest'
import { createApplication } from './entries'
import { getAttentionGroups, getRecentResponses, getStageActions } from './attention'
import { appendStatus } from './status'

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

describe('stage actions and recent responses', () => {
  const role = (id: string, overrides: Parameters<typeof createApplication>[0] extends infer T ? Partial<T> : never = {}) =>
    createApplication({ id, company: id, title: 'Intern', submittedDate: '2026-09-01', effort: 'quick', ...overrides })

  it('turns active employer stages into actions until you schedule or finish them', () => {
    const assessment = appendStatus(role('oa'), 'online_assessment', '2026-09-05')
    const interview = appendStatus(appendStatus(role('int'), 'online_assessment', '2026-09-03'), 'interview', '2026-09-08')
    const planned = { ...appendStatus(role('planned'), 'interview', '2026-09-04'), nextAction: 'Mock interview with Sam' }
    const finished = { ...appendStatus(role('done'), 'online_assessment', '2026-09-04'), nextAction: 'Complete the online assessment', nextActionCompleted: true, nextActionCompletedAt: '2026-09-06T12:00:00.000Z' }
    const earlierDone = { ...appendStatus(role('earlier'), 'interview', '2026-09-09'), nextAction: 'Send thank-you', nextActionCompleted: true, nextActionCompletedAt: '2026-09-02T12:00:00.000Z' }
    const rejected = appendStatus(role('no'), 'rejected', '2026-09-04')

    const actions = getStageActions([assessment, interview, planned, finished, earlierDone, rejected, role('applied')])

    expect(actions.map(({ entry, action, since }) => [entry.id, action, since])).toEqual([
      ['int', 'Prepare for the interview', '2026-09-08'],
      ['earlier', 'Prepare for the interview', '2026-09-09'],
      ['oa', 'Complete the online assessment', '2026-09-05'],
    ])
  })

  it('lists recent employer responses newest first', () => {
    const a = appendStatus(appendStatus(role('a'), 'online_assessment', '2026-09-03'), 'interview', '2026-09-09')
    const b = appendStatus(role('b'), 'rejected', '2026-09-08')
    const old = appendStatus(role('old', { submittedDate: '2026-07-20' }), 'rejected', '2026-08-01')
    const responses = getRecentResponses([a, b, old], '2026-09-10', 14)
    expect(responses.map(({ entry, event }) => `${entry.id}:${event.status}`)).toEqual(['a:interview', 'b:rejected', 'a:online_assessment'])
  })
})
