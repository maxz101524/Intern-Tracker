import { describe, expect, it } from 'vitest'
import { detectApplicationConfirmation, detectApplicationStatusUpdate } from './detector'
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
      company: 'Northstar',
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

  it.each([
    ['Continue to apply for the job Intern–AI and Data Solutions', 'Thank you for your interest. Continue your application to be considered.'],
    ['Verify your email address', 'Thank you for your interest. Use this verification link to confirm your email.'],
    ['Application incomplete', 'We received your profile, but your application is still incomplete.'],
  ])('ignores unfinished or verification mail: %s', (subject, text) => {
    expect(detectApplicationConfirmation(message({
      from: 'Oracle Recruiting <sender@workflow.email.us-phoenix-1.ocs.oraclecloud.com>', subject, text,
    }))).toBeNull()
    expect(detectApplicationStatusUpdate(message({ subject, text }))).toBeNull()
  })
})

describe('application status detection', () => {
  it.each([
    ['Assessment invitation for Data Science Intern at Acme', 'Please complete the assessment by Friday.', 'online_assessment'],
    ['Interview invitation for Data Science Intern at Acme', 'Choose a time to schedule your interview.', 'interview'],
    ['Update on your application for Data Science Intern at Acme', 'Unfortunately, we will not be moving forward.', 'rejected'],
  ])('detects %s', (subject, text, suggestedStatus) => {
    expect(detectApplicationStatusUpdate(message({ from: 'Acme <jobs@acme.com>', subject, text }))).toEqual(expect.objectContaining({
      company: 'Acme', title: 'Data Science Intern', suggestedStatus,
    }))
  })

  it('extracts a RippleMatch rejection instead of treating its body as a new application', () => {
    const result = detectApplicationStatusUpdate(message({
      from: 'RippleMatch Notifications <notifications@ripplematch.com>',
      subject: 'An update from Daikin Comfort Technologies',
      text: 'At this time, they have decided not to move forward with your application for the Data Engineering Intern, Summer 2027 role with Daikin.',
    }))
    expect(result).toEqual(expect.objectContaining({
      company: 'Daikin', title: 'Data Engineering Intern, Summer 2027', suggestedStatus: 'rejected', confidence: 'high',
    }))
    expect(detectApplicationConfirmation(message({
      from: 'RippleMatch Notifications <notifications@ripplematch.com>',
      subject: 'An update from Daikin Comfort Technologies',
      text: 'Thank you for your interest. At this time, they have decided not to move forward with your application for the Data Engineering Intern role with Daikin.',
    }))).toBeNull()
  })

  it.each([
    ['Schedule a recruiter screen for Data Intern at Acme', 'Select a time for your recruiter screen.', 'recruiter_screen'],
    ['Your job offer for Data Intern at Acme', 'We are pleased to offer you the role.', 'offer'],
  ])('detects the broader hiring funnel: %s', (subject, text, suggestedStatus) => {
    expect(detectApplicationStatusUpdate(message({ from: 'Acme <jobs@acme.com>', subject, text })))
      .toEqual(expect.objectContaining({ suggestedStatus }))
  })
})

function message(overrides: Partial<NormalizedGmailMessage>): NormalizedGmailMessage {
  return {
    id: 'm1', threadId: 't1', receivedAt: '2026-09-10T13:30:00.000Z',
    from: 'Recruiting <jobs@example.com>', subject: '', text: '', ...overrides,
  }
}
