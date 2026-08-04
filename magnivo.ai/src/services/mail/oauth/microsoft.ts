import type { OAuthProviderService, OAuthTokenResult, OAuthProfile } from './types'

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const MS_PROFILE_URL = 'https://graph.microsoft.com/v1.0/me'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required for Microsoft OAuth`)
  return v
}

export function getMicrosoftScopes(): string[] {
  // Minimum necessary for send + reply detection (PRD §7)
  return [
    'openid',
    'email',
    'profile',
    'offline_access',
    'https://graph.microsoft.com/Mail.Send',
    'https://graph.microsoft.com/Mail.Read',
    'https://graph.microsoft.com/User.Read',
  ]
}

export class MicrosoftOAuthService implements OAuthProviderService {
  readonly provider = 'outlook' as const

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env('MICROSOFT_CLIENT_ID'),
      redirect_uri: env('MICROSOFT_REDIRECT_URI'),
      response_type: 'code',
      scope: getMicrosoftScopes().join(' '),
      state,
      response_mode: 'query',
    })
    return `${MS_AUTH_URL}?${params.toString()}`
  }

  async exchangeCode(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      code,
      client_id: env('MICROSOFT_CLIENT_ID'),
      client_secret: env('MICROSOFT_CLIENT_SECRET'),
      redirect_uri: env('MICROSOFT_REDIRECT_URI'),
      grant_type: 'authorization_code',
    })
    const res = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Microsoft token exchange failed: ${txt}`)
    }
    const data = await res.json() as Record<string, unknown>
    const expiresIn = Number(data.expires_in ?? 3600)
    return {
      accessToken: String(data.access_token),
      refreshToken: data.refresh_token ? String(data.refresh_token) : null,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scope: String(data.scope ?? ''),
      providerAccountId: '',
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      client_id: env('MICROSOFT_CLIENT_ID'),
      client_secret: env('MICROSOFT_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: getMicrosoftScopes().join(' '),
    })
    const res = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Microsoft token refresh failed: ${txt}`)
    }
    const data = await res.json() as Record<string, unknown>
    const expiresIn = Number(data.expires_in ?? 3600)
    return {
      accessToken: String(data.access_token),
      refreshToken: refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scope: String(data.scope ?? ''),
      providerAccountId: '',
    }
  }

  async getProfile(accessToken: string): Promise<OAuthProfile> {
    const res = await fetch(MS_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch Microsoft profile: ${res.status}`)
    }
    const data = await res.json() as Record<string, unknown>
    return {
      email: String((data as Record<string, unknown>).mail ?? (data as Record<string, unknown>).userPrincipalName ?? ''),
      providerAccountId: String(data.id ?? ''),
      displayName: String(data.displayName ?? ''),
    }
  }
}
