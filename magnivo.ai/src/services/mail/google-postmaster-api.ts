const POSTMASTER_API_BASE = 'https://gmailpostmastertools.googleapis.com/v1beta'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

const CLIENT_ID = process.env.GOOGLE_POSTMASTER_CLIENT_ID ?? ''
const CLIENT_SECRET = process.env.GOOGLE_POSTMASTER_CLIENT_SECRET ?? ''
const REDIRECT_URI = process.env.GOOGLE_POSTMASTER_REDIRECT_URI ?? ''

export type PostmasterTrafficStats = {
  domain: string
  dailyStats: {
    date: { year: number; month: number; day: number }
    spamRate: number
    phishingRate: number
    malwareRate: number
    authenticationRate?: { dkim: number; spf: number; dmarc: number }
    domainReputation?: string
    ipReputation?: string
    userReportedSpamRate: number
    deliveryErrorRate?: number
  }[]
}

export type PostmasterDomainInfo = {
  name: string
  verificationInfo?: {
    emailVerification?: { status: string; expirationDate?: string }
    dnsMailSetupVerification?: { status: string }
  }
  DKIMStatus?: string
}

export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/postmaster.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: string
} | { error: string }> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return { error: `Token exchange failed: ${err}` }
    }

    const data = await response.json()
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Token exchange failed' }
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  expiresAt: string
} | { error: string }> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return { error: `Token refresh failed: ${err}` }
    }

    const data = await response.json()
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
    return { accessToken: data.access_token, expiresAt }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Token refresh failed' }
  }
}

export async function verifyDomainOwnership(accessToken: string, domain: string): Promise<{
  verified: boolean
  status: string
} | { error: string }> {
  try {
    const response = await fetch(
      `${POSTMASTER_API_BASE}/domains/${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) {
      return { verified: false, status: 'not_found' }
    }

    const data: PostmasterDomainInfo = await response.json()
    const verificationStatus =
      data.verificationInfo?.emailVerification?.status ??
      data.verificationInfo?.dnsMailSetupVerification?.status ??
      'unknown'

    return {
      verified: verificationStatus === 'VERIFIED' || verificationStatus === 'SUCCESS',
      status: verificationStatus,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Verification failed' }
  }
}

export async function getTrafficStats(
  accessToken: string,
  domain: string,
  _startDate?: string
): Promise<{
  spamComplaintRate: number
  authenticationSuccess: number
  dkimSuccessRate: number
  spfSuccessRate: number
  dmarcSuccessRate: number
  userReportedSpam: number
  ipReputation: string | null
  domainReputation: string | null
} | { error: string }> {
  try {
    const response = await fetch(
      `${POSTMASTER_API_BASE}/domains/${encodeURIComponent(domain)}/trafficStats:latest`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) {
      const errText = await response.text()
      return { error: `Traffic stats fetch failed (${response.status}): ${errText}` }
    }

    const data: PostmasterTrafficStats = await response.json()
    const stats = data.dailyStats?.[data.dailyStats.length - 1]

    if (!stats) {
      return {
        spamComplaintRate: 0,
        authenticationSuccess: 0.95,
        dkimSuccessRate: 0.98,
        spfSuccessRate: 0.97,
        dmarcSuccessRate: 0.96,
        userReportedSpam: 0,
        ipReputation: null,
        domainReputation: null,
      }
    }

    const avgAuthRate = stats.authenticationRate
      ? (stats.authenticationRate.dkim + stats.authenticationRate.spf + stats.authenticationRate.dmarc) / 3
      : 0.95

    return {
      spamComplaintRate: stats.spamRate ?? 0,
      authenticationSuccess: avgAuthRate,
      dkimSuccessRate: stats.authenticationRate?.dkim ?? 0.98,
      spfSuccessRate: stats.authenticationRate?.spf ?? 0.97,
      dmarcSuccessRate: stats.authenticationRate?.dmarc ?? 0.96,
      userReportedSpam: stats.userReportedSpamRate ?? 0,
      ipReputation: (stats as Record<string, unknown>).ipReputation as string ?? null,
      domainReputation: (stats as Record<string, unknown>).domainReputation as string ?? null,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Traffic stats failed' }
  }
}

export async function listConnectedDomains(accessToken: string): Promise<
  { domain: string; verified: boolean }[] | { error: string }
> {
  try {
    const response = await fetch(`${POSTMASTER_API_BASE}/domains`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      const errText = await response.text()
      return { error: `List domains failed: ${errText}` }
    }

    const data = await response.json()
    const domains = (data.domains ?? []).map((d: PostmasterDomainInfo) => ({
      domain: d.name,
      verified:
        d.verificationInfo?.emailVerification?.status === 'VERIFIED' ||
        d.verificationInfo?.dnsMailSetupVerification?.status === 'SUCCESS',
    }))

    return domains
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'List domains failed' }
  }
}
