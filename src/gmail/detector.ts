import type { DetectionResult, NormalizedGmailMessage, StatusDetectionResult } from './types'

const confirmationMarkers = [
  /thank(?:s| you) for (?:your )?(?:application|applying|interest)/i,
  /we (?:have )?received your application/i,
  /application (?:has been )?received/i,
  /application confirmation/i,
  /successfully applied/i,
]

const excludedSubjects = [
  /\bjob alert\b/i,
  /\bnew .+ jobs?\b/i,
  /\bsaved (?:job|search)\b/i,
  /\bassessment (?:invitation|request)\b/i,
  /\binterview\b/i,
  /\bupdate on your application\b/i,
  /\bapplication status update\b/i,
  /\bunfortunately\b/i,
]

const pairPatterns = [
  /thank(?:s| you) for (?:your interest in|applying (?:to|for)) (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /(?:we (?:have )?)?received your application for (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /successfully applied for (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /application (?:received|confirmation)\s*[-—:]\s*(?:for )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /application for (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})\s+(?:has been|was) received/i,
]

export function detectApplicationConfirmation(message: NormalizedGmailMessage): DetectionResult | null {
  const combined = `${message.subject}\n${message.text}`.replace(/[\t ]+/g, ' ')
  if (excludedSubjects.some((pattern) => pattern.test(message.subject))) return null
  if (!confirmationMarkers.some((pattern) => pattern.test(combined))) return null

  const rule = providerRule(message.from)
  const pair = extractPair(combined)
  if (pair) return { ...pair, confidence: 'high', matchedRule: rule }

  const title = extractTitle(combined)
  const company = extractCompany(message.subject) ?? companyFromSender(message.from)
  if (!title || !company) return null
  return { company, title, confidence: 'medium', matchedRule: rule }
}

export function detectApplicationStatusUpdate(message: NormalizedGmailMessage): StatusDetectionResult | null {
  const combined = `${message.subject}\n${message.text}`.replace(/[\t ]+/g, ' ')
  const suggestedStatus = detectSuggestedStatus(combined)
  if (!suggestedStatus) return null
  const pair = extractStatusPair(combined) ?? extractPair(combined)
  const company = pair?.company ?? extractCompany(message.subject) ?? companyFromSender(message.from)
  if (!company) return null
  const title = pair?.title ?? extractTitle(combined) ?? 'Application update'
  const marker = suggestedStatus === 'online_assessment' ? 'assessment' : suggestedStatus
  return {
    company,
    title,
    suggestedStatus,
    confidence: pair ? 'high' : 'medium',
    matchedRule: `${providerRule(message.from)}-${marker}`,
    supportingSnippet: excerpt(combined),
  }
}

function detectSuggestedStatus(value: string): StatusDetectionResult['suggestedStatus'] | null {
  if (/\b(?:online |coding |technical )?assessment\b|hackerrank|codesignal/i.test(value) &&
      /invite|complete|deadline|next step|request/i.test(value)) return 'online_assessment'
  if (/\binterview\b|phone screen|video call/i.test(value) && /invite|schedule|availability|next step/i.test(value)) return 'interview'
  if (/unfortunately|not (?:be )?moving forward|other candidates|will not proceed|regret to inform/i.test(value)) return 'rejected'
  return null
}

function extractStatusPair(value: string): Pick<DetectionResult, 'company' | 'title'> | null {
  const patterns = [
    /(?:assessment|interview) (?:invitation|request)?\s*(?:for|-)\s*(?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
    /update (?:on|regarding) your application (?:for|to) (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
    /(?:role|position)\s*:\s*([^\n|]{2,100}).{0,80}?(?:company|organization)\s*:\s*([^\n|]{2,80})/i,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (match) return { title: cleanTitle(match[1]), company: cleanCompany(match[2]) }
  }
  return null
}

function excerpt(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > 220 ? `${text.slice(0, 217)}…` : text
}

function extractPair(value: string): Pick<DetectionResult, 'company' | 'title'> | null {
  for (const pattern of pairPatterns) {
    const match = value.match(pattern)
    if (!match) continue
    const title = cleanTitle(match[1])
    const company = cleanCompany(match[2])
    if (title && company) return { company, title }
  }
  return null
}

function extractTitle(value: string): string | null {
  const labeled = value.match(/(?:job title|role|position)\s*:\s*([^\n.!?]{2,100})/i)?.[1]
  if (labeled) return cleanTitle(labeled)
  const application = value.match(/application for (?:the )?([^\n.!?]{2,100}?)(?: position| role)?(?:[.!?\n]|$)/i)?.[1]
  return application ? cleanTitle(application) : null
}

function extractCompany(subject: string): string | null {
  const value = subject.match(/(?:applying to|application to|received by)\s+([^\n.!?—-]{2,80})/i)?.[1]
  return value ? cleanCompany(value) : null
}

function companyFromSender(sender: string): string | null {
  const display = sender.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]
  if (display) {
    const cleaned = cleanCompany(display.replace(/\s+via\s+.+$/i, ''))
    if (cleaned && !/^(recruiting|talent|careers?|jobs?|notifications?|recruiting platform)$/i.test(cleaned)) return cleaned
  }

  const domain = sender.match(/@([a-z0-9.-]+)>?/i)?.[1]?.toLowerCase()
  if (!domain || /(workday|greenhouse|lever|ashbyhq|smartrecruiters|icims|example)\./.test(domain)) return null
  const labels = domain.split('.')
  const root = labels.at(-2)
  if (!root || /^(mail|email|jobs|careers|recruiting|notifications?)$/.test(root)) return null
  return root.charAt(0).toUpperCase() + root.slice(1)
}

function providerRule(sender: string): string {
  const value = sender.toLowerCase()
  if (value.includes('workday')) return 'workday-confirmation'
  if (value.includes('greenhouse')) return 'greenhouse-confirmation'
  if (value.includes('lever.co')) return 'lever-confirmation'
  if (value.includes('ashby')) return 'ashby-confirmation'
  if (value.includes('smartrecruiters')) return 'smartrecruiters-confirmation'
  if (value.includes('icims')) return 'icims-confirmation'
  return 'generic-confirmation'
}

function cleanTitle(value: string): string {
  return clean(value).replace(/^(?:the|a)\s+/i, '').replace(/\s+(?:position|role)$/i, '').trim()
}

function cleanCompany(value: string): string {
  return clean(value).replace(/\s+(?:careers?|recruiting team)$/i, '').trim()
}

function clean(value: string): string {
  return value.replace(/^[\s"'“”]+|[\s"'“”,:;—-]+$/g, '').replace(/\s+/g, ' ').trim()
}
