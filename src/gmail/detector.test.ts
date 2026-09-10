import { describe, expect, it } from 'vitest'
import { detectApplicationConfirmation } from './detector'
import type { NormalizedGmailMessage } from './types'

describe('application confirmation detection', () => {
  it.each([
    ['workday-confirmation', 'Acme <noreply@myworkday.com>', 'Thank you for applying to Acme', 'We received your application for the Data Science Intern position at Acme.'],
    ['greenhouse-confirmation', 'Acme via Greenhouse <no-reply@greenhouse.io>', 'Application received', 'Thank you for applying to the ML Engineer Intern role at Acme.'],
    ['lever-confirmation', 'Acme <no-reply@hire.lever.co>', 'Acme application confirmation', 'Thanks for applying for the Analytics Intern role at Acme.'],
    ['ashby-confirmation', 'Acme <no-reply@ashbyhq.com>', 'Application received — Applied AI Intern at Acme', 'Your application has been received.'],
    ['smartrecruiters-confirmation', 'Acme <no-reply@smartrecruiters.com>', 'Your application to Acme', 'You have successfully applied for Data Science Intern at Acme.'],
    ['icims-confirmation', 'Acme <jobs@icims.com>', 'Application received by Acme', 'We have received your application for Software Engineer Intern at Acme.'],
    ['generic-confirmation', 'Acme Recruiting <jobs@acme.com>', 'Thank you for applying', 'Thank you for applying to Product Analytics Intern at Acme.'],
  ])('detects %s messages', (matchedRule, from, subject, text) => {
    expect(detectApplicationConfirmation(message({ from, subject, text }))).toEqual(expect.objectContaining({
      company: 'Acme',
      title: expect.stringMatching(/Intern/),
      confidence: 'high',
      matchedRule,
    }))
  })

  it('uses labeled fields and sender display name as a medium-confidence fallback', () => {
    expect(detectApplicationConfirmation(message({
      from: 'Northstar Recruiting <talent@northstar.ai>',
      subject: 'We received your application',
      text: 'Thank you for your application. Job Title: Machine Learning Intern',
    }))).toEqual(expect.objectContaining({
      company: 'Northstar Recruiting',
      title: 'Machine Learning Intern',
      confidence: 'medium',
    }))
  })

  it.each([
    ['New Data Science Intern jobs near you', 'Your weekly job alert'],
    ['You saved Data Science Intern', 'Return to your saved job'],
    ['Assessment invitation — Acme', 'Please complete this assessment'],
    ['Interview availability', 'Choose a time to interview'],
    ['An update on your application', 'Unfortunately, we will not be moving forward'],
    ['Hello from Acme Recruiting', 'I found your profile and would like to connect'],
  ])('excludes non-confirmation mail: %s', (subject, text) => {
    expect(detectApplicationConfirmation(message({ subject, text }))).toBeNull()
  })

  it('rejects confirmation-like text without both a company and role', () => {
    expect(detectApplicationConfirmation(message({
      from: 'Recruiting Platform <no-reply@notifications.example>',
      subject: 'Application received',
      text: 'We received your application. Thank you for applying.',
    }))).toBeNull()
  })
})

function message(overrides: Partial<NormalizedGmailMessage>): NormalizedGmailMessage {
  return {
    id: 'm1', threadId: 't1', receivedAt: '2026-09-10T13:30:00.000Z',
    from: 'Recruiting <jobs@example.com>', subject: '', text: '', ...overrides,
  }
}
