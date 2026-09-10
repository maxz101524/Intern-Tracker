import { describe, expect, it } from 'vitest'
import { normalizeGmailMessage } from './message'
import type { GmailApiMessage } from './types'

describe('Gmail message normalization', () => {
  it('decodes the plain-text branch of nested URL-safe base64 MIME', () => {
    const result = normalizeGmailMessage({
      id: 'm1',
      threadId: 't1',
      internalDate: '1789047000000',
      payload: {
        headers: [
          { name: 'From', value: 'Acme Recruiting <jobs@acme.com>' },
          { name: 'Subject', value: 'Application received' },
        ],
        mimeType: 'multipart/mixed',
        parts: [{
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: encode('Thank you for applying.\r\nWe received it.') } },
            { mimeType: 'text/html', body: { data: encode('<p>HTML duplicate</p>') } },
          ],
        }],
      },
    })

    expect(result).toEqual({
      id: 'm1',
      threadId: 't1',
      receivedAt: new Date(1789047000000).toISOString(),
      from: 'Acme Recruiting <jobs@acme.com>',
      subject: 'Application received',
      text: 'Thank you for applying.\nWe received it.',
    })
  })

  it('converts an HTML-only message into readable text', () => {
    const result = normalizeGmailMessage(messageWithBody(
      'text/html',
      '<style>.hidden{display:none}</style><p>Thank you&nbsp;for applying</p><script>bad()</script><p>Role: ML Intern</p>',
    ))

    expect(result.text).toBe('Thank you for applying Role: ML Intern')
  })

  it('uses safe labels when optional headers are absent', () => {
    const result = normalizeGmailMessage({
      ...messageWithBody('text/plain', 'We received your application.'),
      payload: { mimeType: 'text/plain', body: { data: encode('We received your application.') } },
    })

    expect(result.from).toBe('Unknown sender')
    expect(result.subject).toBe('(No subject)')
  })

  it('rejects malformed identity and body data with a content-free error', () => {
    expect(() => normalizeGmailMessage({ ...messageWithBody('text/plain', 'secret body'), id: '' }))
      .toThrow('Gmail message could not be read.')
    expect(() => normalizeGmailMessage({ ...messageWithBody('text/plain', 'secret body'), internalDate: 'not-a-date' }))
      .toThrow('Gmail message could not be read.')
  })
})

function messageWithBody(mimeType: string, body: string): GmailApiMessage {
  return {
    id: 'm1', threadId: 't1', internalDate: '1789047000000',
    payload: { mimeType, body: { data: encode(body) } },
  }
}

function encode(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
