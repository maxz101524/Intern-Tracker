import type { DetectionResult, NormalizedGmailMessage, StatusDetectionResult } from './types'

const confirmationMarkers = [
  /thank(?:s| you) for (?:submitting|applying)/i,
  /thank(?:s| you) for your application/i,
  /we (?:have )?(?:successfully )?received your application/i,
  /your application (?:has been|was) (?:successfully )?(?:received|submitted)/i,
  /application (?:has been )?(?:received|submitted successfully)/i,
  /application confirmation/i,
  /successfully applied/i,
]

const nonApplicationMarkers = [
  /\b(?:continue|finish|complete|resume) (?:your |the )?(?:job )?application\b/i,
  /\bapplication (?:is |still )?(?:incomplete|unfinished|in progress|a draft)\b/i,
  /\b(?:draft|started) application\b/i,
  /\b(?:verify|confirm) (?:your )?email(?: address)?\b/i,
  /\bemail (?:address )?verification\b/i,
  /\bverification (?:code|link)\b/i,
  /\bactivate your (?:account|profile)\b/i,
  /\bcreate (?:an?|your) (?:account|candidate profile)\b/i,
]

const unrelatedMarkers = [
  /\bjob alert\b/i,
  /\bnew .+ jobs?\b/i,
  /\bsaved (?:job|search)\b/i,
  /\brecommended jobs?\b/i,
  /\bjobs? you may (?:like|be interested in)\b/i,
  /\brecruiter (?:reached out|message)\b/i,
]

const pairPatterns = [
  /thank(?:s| you) for (?:submitting your application|applying|your application) (?:to|for)?\s*(?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /(?:we (?:have )?)?received your application for (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /successfully applied for (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /application (?:received|confirmation|submitted)\s*[-—:]\s*(?:for )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
  /application for (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})\s+(?:has been|was) (?:received|submitted)/i,
]

export function detectApplicationConfirmation(message: NormalizedGmailMessage): DetectionResult | null {
  const combined = normalizeText(`${message.subject}\n${message.text}`)
  if (unrelatedMarkers.some((pattern) => pattern.test(message.subject))) return null
  if (nonApplicationMarkers.some((pattern) => pattern.test(combined))) return null
  if (detectSuggestedStatus(combined)) return null
  if (!confirmationMarkers.some((pattern) => pattern.test(combined))) return null

  const rule = providerRule(message.from)
  const pair = extractPair(combined)
  if (pair && isPlausibleIdentity(pair)) return { ...pair, confidence: 'high', matchedRule: rule }

  const title = extractTitle(combined)
  const company = extractCompany(message.subject) ?? companyFromSender(message.from)
  if (!title || !company || !isPlausibleIdentity({ title, company })) return null
  return { company, title, confidence: 'medium', matchedRule: rule }
}

export function detectApplicationStatusUpdate(message: NormalizedGmailMessage): StatusDetectionResult | null {
  const combined = normalizeText(`${message.subject}\n${message.text}`)
  if (nonApplicationMarkers.some((pattern) => pattern.test(combined))) return null
  const suggestedStatus = detectSuggestedStatus(combined)
  if (!suggestedStatus) return null

  const pair = extractStatusPair(combined) ?? extractPair(combined)
  const company = pair?.company ?? extractCompany(message.subject) ?? companyFromSender(message.from)
  if (!company || !isPlausibleCompany(company)) return null
  const title = pair?.title ?? extractTitle(combined) ?? 'Application update'
  const marker = suggestedStatus === 'online_assessment' ? 'assessment' : suggestedStatus.replace('_', '-')
  return {
    company,
    title,
    suggestedStatus,
    confidence: pair && title !== 'Application update' ? 'high' : 'medium',
    matchedRule: `${providerRule(message.from).replace('-confirmation', '')}-${marker}`,
    supportingSnippet: excerptAroundStatus(combined),
  }
}

function detectSuggestedStatus(value: string): StatusDetectionResult['suggestedStatus'] | null {
  // A rejection can mention an earlier interview or assessment, so terminal states win.
  if (
    /\b(?:unfortunately|regret to inform|not selected|not be selected|declined your application|no longer (?:being |under )?consideration|position (?:has been|was) filled)\b/i.test(value) ||
    /\b(?:decided|chosen|will|are|have) (?:to )?not (?:to )?(?:move|moving|proceed|continue|advance)/i.test(value) ||
    /\b(?:will not|won't|cannot|unable to) (?:move|be moving|proceed|continue|advance) (?:you |your application )?forward\b/i.test(value) ||
    /\b(?:moving|proceeding|continue) (?:ahead |forward )?with (?:another|other) candidates?\b/i.test(value)
  ) return 'rejected'

  if (/\b(?:pleased|delighted|excited) to (?:extend|offer)|\boffer of employment\b|\bjob offer\b/i.test(value)) return 'offer'
  if (/\b(?:interview|virtual interview|onsite|on-site|superday|final round)\b/i.test(value) && /invite|schedule|availability|select a time|next (?:step|round)|meet with/i.test(value)) return 'interview'
  if (/\b(?:phone screen|recruiter screen|introductory call|initial call)\b/i.test(value) && /invite|schedule|availability|select a time|next step/i.test(value)) return 'recruiter_screen'
  if (/\b(?:online |coding |technical |pre-employment )?assessment\b|hackerrank|codesignal|codility|hirevue/i.test(value) && /invite|complete|deadline|due|next step|request|assigned/i.test(value)) return 'online_assessment'
  return null
}

function extractStatusPair(value: string): Pick<DetectionResult, 'company' | 'title'> | null {
  const patterns = [
    /(?:assessment|interview|phone screen) (?:invitation|request)?\s*(?:for|-)\s*(?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
    /(?:update (?:on|regarding)|regarding) your application (?:for|to) (?:the )?(.+?)(?: position| role)?\s+at\s+([^\n.!?]{2,80})/i,
    /your application (?:for|to) (?:the )?(.+?)(?: position| role)?\s+(?:at|with)\s+([^\n.!?]{2,80})/i,
    /(?:the )?([^\n.!?]{3,100}?)\s+(?:position|role)\s+(?:at|with)\s+([^\n.!?]{2,80})/i,
    /(?:role|position)\s*:\s*([^\n|]{2,100}).{0,120}?(?:company|organization)\s*:\s*([^\n|]{2,80})/i,
  ]
  for (const pattern of patterns) {
    const match = value.match(pattern)
    if (!match) continue
    const pair = { title: cleanTitle(match[1]), company: cleanCompany(match[2]) }
    if (isPlausibleIdentity(pair)) return pair
  }
  return null
}

function excerptAroundStatus(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim()
  const marker = text.search(/unfortunately|regret|not selected|not (?:be )?moving|assessment|hackerrank|codesignal|interview|phone screen|offer/i)
  const start = Math.max(0, marker < 0 ? 0 : marker - 70)
  const selected = text.slice(start, start + 260)
  return `${start > 0 ? '…' : ''}${selected}${start + 260 < text.length ? '…' : ''}`
}

function extractPair(value: string): Pick<DetectionResult, 'company' | 'title'> | null {
  for (const pattern of pairPatterns) {
    const match = value.match(pattern)
    if (!match) continue
    const pair = { title: cleanTitle(match[1]), company: cleanCompany(match[2]) }
    if (isPlausibleIdentity(pair)) return pair
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
  const patterns = [
    /\bupdate from\s+([^\n.!?—|]{2,80})/i,
    /(?:applying to|application to|received by)\s+([^\n.!?—|]{2,80})/i,
    /\byour\s+([^\n.!?—|]{2,70}?)\s+application(?:\s+update)?$/i,
  ]
  for (const pattern of patterns) {
    const match = subject.match(pattern)
    if (match) return cleanCompany(match[1])
  }
  return null
}

function companyFromSender(sender: string): string | null {
  const display = sender.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]
  if (display) {
    const cleaned = cleanCompany(display
      .replace(/\s+via\s+.+$/i, '')
      .replace(/\s+(?:notifications?|talent acquisition|recruiting|careers?|jobs?)$/i, ''))
    if (cleaned && !/^(recruiting|talent|careers?|jobs?|notifications?|recruiting platform|no[- ]?reply)$/i.test(cleaned)) return cleaned
  }

  const domain = sender.match(/@([a-z0-9.-]+)>?/i)?.[1]?.toLowerCase()
  if (!domain || /(workday|greenhouse|lever|ashbyhq|smartrecruiters|icims|ripplematch|oraclecloud|example)\./.test(domain)) return null
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
  if (value.includes('ripplematch')) return 'ripplematch-confirmation'
  if (value.includes('oraclecloud')) return 'oracle-confirmation'
  return 'generic-confirmation'
}

function isPlausibleIdentity(pair: Pick<DetectionResult, 'company' | 'title'>): boolean {
  return isPlausibleCompany(pair.company) && pair.title.length >= 3 &&
    !/^(?:application|application update|job|role|position)$/i.test(pair.title) &&
    !/decided|move forward|other candidates|unfortunately|thank you/i.test(pair.title)
}

function isPlausibleCompany(value: string): boolean {
  return value.length >= 2 && value.length <= 80 &&
    !/decided|move forward|other candidates|your application|this time|unfortunately/i.test(value)
}

function cleanTitle(value: string): string {
  return clean(value)
    .replace(/^(?:the|a|job)\s+/i, '')
    .replace(/\s+(?:position|role)$/i, '')
    .replace(/^job\s+/i, '')
    .trim()
}

function cleanCompany(value: string): string {
  return clean(value).replace(/\s+(?:careers?|recruiting team)$/i, '').trim()
}

function clean(value: string): string {
  return value.replace(/^[\s"'“”]+|[\s"'“”,:;—-]+$/g, '').replace(/\s+/g, ' ').trim()
}

function normalizeText(value: string): string {
  return value.replace(/\u00a0/g, ' ').replace(/[\t ]+/g, ' ')
}
