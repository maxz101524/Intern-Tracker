export interface GmailMessageHeader {
  name?: string
  value?: string
}

export interface GmailMessagePart {
  mimeType?: string
  headers?: GmailMessageHeader[]
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailMessagePart[]
}

export interface GmailApiMessage {
  id?: string
  threadId?: string
  internalDate?: string
  historyId?: string
  payload?: GmailMessagePart
}

export interface NormalizedGmailMessage {
  id: string
  threadId: string
  receivedAt: string
  from: string
  subject: string
  text: string
}

export interface DetectionResult {
  company: string
  title: string
  confidence: 'high' | 'medium'
  matchedRule: string
}
