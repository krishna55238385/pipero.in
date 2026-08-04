import pool from '@/lib/db'
import * as trackingRepo from '@/repositories/mail/tracking-repository'

const KNOWN_BOT_PATTERNS: RegExp[] = [
  /googlebot/i,
  /bingbot/i,
  /slurp/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /facebookexternalhit/i,
  /facebot/i,
  /twitterbot/i,
  /slackbot/i,
  /slack.*link/i,
  /discordbot/i,
  /telegrambot/i,
  /whatsapp/i,
  /applebot/i,
  /semrushbot/i,
  /ahrefsbot/i,
  /majestic/i,
  /rogerbot/i,
  /dotbot/i,
  /mj12bot/i,
  /blexbot/i,
  /exabot/i,
  /nutch/i,
  /zgrab/i,
  /wget/i,
  /curl/i,
  /python-requests/i,
  /python-urllib/i,
  /go-http-client/i,
  /okhttp/i,
  /axios/i,
  /litmus/i,
  /email on acid/i,
  /preview.*email/i,
  /email.*preview/i,
  /mailtrack/i,
  /hubspot.*email/i,
  /salesforce.*email/i,
  /outreach.*email/i,
  /yesware/i,
  /mixmax/i,
  /streak/i,
  /bananatag/i,
  /signalhire/i,
  /reply\.io/i,
  /mailchimp/i,
  /sendgrid.*email/i,
  /postmark/i,
  /sparkpost/i,
  /sendinblue/i,
  /brevo/i,
  /mailgun.*track/i,
  /amazon.*ses.*track/i,
  /bot/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /headless/i,
  /phantomjs/i,
  /puppeteer/i,
  /playwright/i,
  /selenium/i,
  /chromium.*headless/i,
  /lighthouse/i,
  /pingdom/i,
  /uptime/i,
  /newrelic/i,
  /datadog/i,
  /statuscake/i,
  /freshping/i,
  /prerender/i,
  /cloudflare/i,
  /cfnetwork/i,
  /zonos/i,
  /aspiegel/i,
]

const APPLE_MAIL_PRIVACY_PATTERNS: RegExp[] = [
  /mac.*apple.*mail.*privacy/i,
  /Apple.*Mail.*Privacy.*Protection/i,
  /Mac OS X.*Mail/i,
  /Macintosh.*Mail/i,
]

const OUTLOOK_SAFELINK_PATTERNS: RegExp[] = [
  /safelink/i,
  /microsoft.*safelink/i,
  /outlook.*safe/i,
]

const ipRateMap = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 100

function isAppleMailProtection(userAgent: string): boolean {
  return APPLE_MAIL_PRIVACY_PATTERNS.some((p) => p.test(userAgent))
}

function isOutlookSafeLink(userAgent: string): boolean {
  return OUTLOOK_SAFELINK_PATTERNS.some((p) => p.test(userAgent))
}

export function isKnownBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  return KNOWN_BOT_PATTERNS.some((pattern) => pattern.test(userAgent))
}

export async function isRateLimited(ipAddress: string): Promise<boolean> {
  const now = Date.now()
  const entry = ipRateMap.get(ipAddress)

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    ipRateMap.set(ipAddress, { count: 1, windowStart: now })
    return false
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true
  }

  entry.count++
  return false
}

setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of ipRateMap.entries()) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
      ipRateMap.delete(ip)
    }
  }
}, 60_000)

export async function shouldFilterOpen(
  tokenId: string,
  context: { userAgent?: string; ipAddress?: string }
): Promise<{ filtered: boolean; reason?: string }> {
  if (context.userAgent) {
    if (isAppleMailProtection(context.userAgent)) {
      return { filtered: true, reason: 'Apple Mail Privacy Protection prefetch' }
    }

    if (isOutlookSafeLink(context.userAgent)) {
      return { filtered: true, reason: 'Outlook SafeLinks protection' }
    }

    if (isKnownBot(context.userAgent)) {
      return { filtered: true, reason: 'Known bot user agent' }
    }
  }

  const token = await trackingRepo.findTrackingToken(tokenId)
  if (!token) {
    return { filtered: true, reason: 'Invalid or expired token' }
  }

  if (token.usedAt) {
    return { filtered: true, reason: 'Duplicate event (token already used)' }
  }

  if (context.ipAddress) {
    const limited = await isRateLimited(context.ipAddress)
    if (limited) {
      return { filtered: true, reason: 'IP rate limited' }
    }
  }

  return { filtered: false }
}

export async function shouldFilterClick(
  tokenId: string,
  context: { userAgent?: string; ipAddress?: string }
): Promise<{ filtered: boolean; reason?: string }> {
  if (context.userAgent) {
    if (isOutlookSafeLink(context.userAgent)) {
      return { filtered: true, reason: 'Outlook SafeLinks protection' }
    }

    if (isKnownBot(context.userAgent)) {
      return { filtered: true, reason: 'Known bot user agent' }
    }
  }

  const token = await trackingRepo.findTrackingToken(tokenId)
  if (!token) {
    return { filtered: true, reason: 'Invalid or expired token' }
  }

  if (token.usedAt) {
    return { filtered: true, reason: 'Duplicate event (token already used)' }
  }

  if (context.ipAddress) {
    const limited = await isRateLimited(context.ipAddress)
    if (limited) {
      return { filtered: true, reason: 'IP rate limited' }
    }
  }

  return { filtered: false }
}

export async function recordFilteredEvent(data: {
  organizationId: string
  tokenId: string
  eventType: 'open' | 'click'
  reason: string
  userAgent?: string
  ipAddress?: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_tracking_log
      (organization_id, tracking_token_id, event_type, reason, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      data.organizationId,
      data.tokenId,
      data.eventType,
      data.reason,
      data.userAgent ?? null,
      data.ipAddress ?? null,
    ]
  )
}
