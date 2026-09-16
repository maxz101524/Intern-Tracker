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

  it('treats a Workday receipt as a new application despite hypothetical rejection language', () => {
    const email = message({
      from: 'Workday at S&P Global <spgi@myworkday.com>',
      subject: 'Thank you for your Application!',
      text: 'Thank you for your interest in Kensho. We wanted to let you know we received your application for Machine Learning Engineer - Summer Intern 2027, and we are delighted that you would consider joining our team. Our team will review your application and will be in touch if your qualifications match our needs for the role. If you are not selected for the position, keep an eye on our jobs page as we are growing and adding openings.',
    })

    expect(detectApplicationStatusUpdate(email)).toBeNull()
    expect(detectApplicationConfirmation(email)).toEqual(expect.objectContaining({
      company: 'Kensho',
      title: 'Machine Learning Engineer - Summer Intern 2027',
      confidence: 'high',
      matchedRule: 'workday-confirmation',
    }))
  })

  it('queues a Figma receipt for manual role entry instead of calling it a rejection', () => {
    const email = message({
      from: 'no-reply@figma.com',
      subject: 'Thank you for your application to Figma',
      text: 'Our team will review your application. If you are not selected for this position, keep an eye on our jobs page as we are growing and adding openings. Warm regards, The Figma Team.',
    })

    expect(detectApplicationStatusUpdate(email)).toBeNull()
    expect(detectApplicationConfirmation(email)).toEqual(expect.objectContaining({
      company: 'Figma',
      title: 'Role needs review',
      confidence: 'medium',
    }))
  })

  it('treats a Cigna receipt as a new application despite conditional interview guidance', () => {
    const email = message({
      from: 'Cigna Notifications <CignaNotifications@workday.cigna.com>',
      subject: "Application Received - The Cigna Group - The Cigna Group's Technology Development Program - AI Engineering Track Summer Internship - 26009535",
      text: "We received your application for the The Cigna Group's Technology Development Program - AI Engineering Track Summer Internship - 26009535 position. Over the coming weeks, our recruiting team will assess applications for this position. If you're selected to move forward, you'll be invited to meet with a recruiter to discuss this opportunity further. Visit our How We Hire page for resources like interview tips and more.",
    })

    expect(detectApplicationStatusUpdate(email)).toBeNull()
    expect(detectApplicationConfirmation(email)).toEqual(expect.objectContaining({
      company: 'Cigna',
      title: expect.stringContaining('AI Engineering Track Summer Internship'),
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
