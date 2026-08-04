const SNDS_API_BASE = 'https://sendersupport.olc.protection.outlook.com/snds/api/v1.0'
const SNDS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'

const SNDS_CLIENT_ID = process.env.MICROSOFT_SNDS_CLIENT_ID ?? ''
const SNDS_CLIENT_SECRET = process.env.MICROSOFT_SNDS_CLIENT_SECRET ?? ''
const SNDS_REDIRECT_URI = process.env.MICROSOFT_SNDS_REDIRECT_URI ?? ''

export type SndsIpData = {
  IP: string
  Timestamp: string
  SpamThreshold?: number
  SpamCount?: number
  TrapCount?: number
  BounceRate?: number
  SpamRate?: number
  MalwareCount?: number
  NetworkSpamCount?: number
}

export type SndsDailyData = {
  date: string
  spamComplaintRate: number
  trapHits: number
  malwareCount: number
  networkSpamCount: number
  ipReputation: string | null
}

export function getSndsAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: SNDS_CLIENT_ID,
    redirect_uri: SNDS_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://outlook.office365.com/.default offline_access',
    state,
  })
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
}

export async function exchangeSndsCode(code: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresAt: string
} | { error: string }> {
  try {
    const response = await fetch(SNDS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: SNDS_CLIENT_ID,
        client_secret: SNDS_CLIENT_SECRET,
        redirect_uri: SNDS_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return { error: `SNDS token exchange failed: ${err}` }
    }

    const data = await response.json()
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'SNDS token exchange failed' }
  }
}

export async function refreshSndsToken(refreshToken: string): Promise<{
  accessToken: string
  expiresAt: string
} | { error: string }> {
  try {
    const response = await fetch(SNDS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SNDS_CLIENT_ID,
        client_secret: SNDS_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return { error: `SNDS token refresh failed: ${err}` }
    }

    const data = await response.json()
    const expiresAt = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString()
    return { accessToken: data.access_token, expiresAt }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'SNDS token refresh failed' }
  }
}

export async function getSndsDailyData(
  accessToken: string,
  ip: string,
  startDate: string,
  endDate: string
): Promise<SndsDailyData[] | { error: string }> {
  try {
    const response = await fetch(
      `${SNDS_API_BASE}/data/ip/${encodeURIComponent(ip)}/daily/${startDate}/${endDate}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) {
      const errText = await response.text()
      return { error: `SNDS daily data fetch failed (${response.status}): ${errText}` }
    }

    const data: SndsIpData[] = await response.json()
    return data.map((entry) => ({
      date: entry.Timestamp?.split('T')[0] ?? new Date().toISOString().split('T')[0],
      spamComplaintRate: entry.SpamRate ?? 0,
      trapHits: entry.TrapCount ?? 0,
      malwareCount: entry.MalwareCount ?? 0,
      networkSpamCount: entry.NetworkSpamCount ?? 0,
      ipReputation: determineIpReputation(entry),
    }))
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'SNDS daily data failed' }
  }
}

export async function getSndsLatestData(
  accessToken: string,
  ip: string
): Promise<SndsDailyData | { error: string }> {
  try {
    const response = await fetch(
      `${SNDS_API_BASE}/data/ip/${encodeURIComponent(ip)}/latest`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!response.ok) {
      const errText = await response.text()
      return { error: `SNDS latest data fetch failed (${response.status}): ${errText}` }
    }

    const data: SndsIpData = await response.json()
    return {
      date: data.Timestamp?.split('T')[0] ?? new Date().toISOString().split('T')[0],
      spamComplaintRate: data.SpamRate ?? 0,
      trapHits: data.TrapCount ?? 0,
      malwareCount: data.MalwareCount ?? 0,
      networkSpamCount: data.NetworkSpamCount ?? 0,
      ipReputation: determineIpReputation(data),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'SNDS latest data failed' }
  }
}

function determineIpReputation(data: SndsIpData): string | null {
  const spamRate = data.SpamRate ?? 0
  const trapCount = data.TrapCount ?? 0
  const malwareCount = data.MalwareCount ?? 0

  if (malwareCount > 0 || trapCount > 0) return 'poor'
  if (spamRate > 0.1) return 'poor'
  if (spamRate > 0.01) return 'fair'
  if (spamRate > 0.001) return 'good'
  return 'healthy'
}

export async function sendSndsFeedbackReport(
  accessToken: string,
  reportData: {
    domain: string
    issue: string
    logs: string
  }
): Promise<{ submitted: boolean; error?: string }> {
  try {
    const response = await fetch(`${SNDS_API_BASE}/feedback`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(reportData),
    })

    if (!response.ok) {
      const errText = await response.text()
      return { submitted: false, error: `Feedback submission failed: ${errText}` }
    }

    return { submitted: true }
  } catch (err) {
    return { submitted: false, error: err instanceof Error ? err.message : 'Feedback failed' }
  }
}
