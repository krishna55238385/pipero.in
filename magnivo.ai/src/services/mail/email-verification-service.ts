import dns from 'dns/promises'

export type EmailVerificationStatus = 'valid' | 'invalid' | 'risky' | 'catch_all' | 'no_mx' | 'unverified'

export type EmailVerificationResult = {
  email: string
  status: EmailVerificationStatus
  reason?: string
  mxHosts?: string[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'tempmail.com',
  '10minutemail.com',
  'yopmail.com',
  'trashmail.com',
])

export async function verifyEmailAddress(email: string): Promise<EmailVerificationResult> {
  const normalized = email.trim().toLowerCase()
  if (!EMAIL_RE.test(normalized)) {
    return { email: normalized, status: 'invalid', reason: 'Invalid email syntax' }
  }

  const domain = normalized.split('@')[1]
  if (!domain) {
    return { email: normalized, status: 'invalid', reason: 'Missing domain' }
  }

  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { email: normalized, status: 'risky', reason: 'Disposable email domain' }
  }

  try {
    const mx = await dns.resolveMx(domain)
    if (!mx || mx.length === 0) {
      // Some domains only have A records
      try {
        await dns.resolve4(domain)
        return { email: normalized, status: 'risky', reason: 'No MX; A record only (possible catch-all)' }
      } catch {
        return { email: normalized, status: 'no_mx', reason: 'No MX or A records' }
      }
    }
    const mxHosts = mx.sort((a, b) => a.priority - b.priority).map((r) => r.exchange)
    // Catch-all detection without SMTP probe: mark common enterprise patterns as risky when MX is generic
    const catchAllLikely = mxHosts.some((h) => /aspmx\.l\.google|outlook\.com|protection\.outlook/i.test(h))
    return {
      email: normalized,
      status: catchAllLikely ? 'catch_all' : 'valid',
      mxHosts,
      reason: catchAllLikely ? 'Provider MX may accept catch-all' : undefined,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'DNS lookup failed'
    if (/ENOTFOUND|ENODATA|SERVFAIL/i.test(message)) {
      return { email: normalized, status: 'no_mx', reason: message }
    }
    return { email: normalized, status: 'risky', reason: message }
  }
}
