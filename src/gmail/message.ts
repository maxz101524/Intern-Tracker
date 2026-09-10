import type { GmailApiMessage, GmailMessagePart, NormalizedGmailMessage } from './types'

const READ_ERROR = 'Gmail message could not be read.'

export function normalizeGmailMessage(message: GmailApiMessage): NormalizedGmailMessage {
  try {
    const id = required(message.id)
    const threadId = required(message.threadId)
    const timestamp = Number(message.internalDate)
    if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error()
    const receivedAt = new Date(timestamp).toISOString()
    const payload = message.payload
    if (!payload) throw new Error()

    const plainParts: string[] = []
    const htmlParts: string[] = []
    collectText(payload, plainParts, htmlParts)
    const source = plainParts.length > 0 ? plainParts.join('\n') : htmlParts.map(htmlToText).join('\n')

    return {
      id,
      threadId,
      receivedAt,
      from: header(payload, 'from') || 'Unknown sender',
      subject: header(payload, 'subject') || '(No subject)',
      text: cleanText(source),
    }
  } catch {
    throw new Error(READ_ERROR)
  }
}

function collectText(part: GmailMessagePart, plain: string[], html: string[]): void {
  if (part.body?.data && part.mimeType === 'text/plain') plain.push(decodeBase64Url(part.body.data))
  if (part.body?.data && part.mimeType === 'text/html') html.push(decodeBase64Url(part.body.data))
  for (const child of part.parts ?? []) collectText(child, plain, html)
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function htmlToText(html: string): string {
  const spaced = html.replace(/<\/(p|div|li|h[1-6])\s*>/gi, '</$1> ').replace(/<br\s*\/?\s*>/gi, ' ')
  const document = new DOMParser().parseFromString(spaced, 'text/html')
  document.querySelectorAll('script, style, noscript').forEach((node) => node.remove())
  return document.body.textContent ?? ''
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function header(payload: GmailMessagePart, name: string): string {
  return payload.headers?.find((item) => item.name?.toLowerCase() === name)?.value?.trim() ?? ''
}

function required(value?: string): string {
  const result = value?.trim()
  if (!result) throw new Error()
  return result
}
