import type { OAuthProviderService, OAuthTokenResult, OAuthProfile } from './types'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_PROFILE_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required for Gmail OAuth`)
  return v
}

export function getGoogleScopes(): string[] {
  // PRD §6.1 / §7: minimum-necessary scopes only
  return [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
  ]
}

export class GoogleOAuthService implements OAuthProviderService {
  readonly provider = 'gmail' as const

  getAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      redirect_uri: env('GOOGLE_REDIRECT_URI'),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'select_account consent',
      scope: getGoogleScopes().join(' '),
      state,
    })
    return `${GOOGLE_AUTH_URL}?${params.toString()}`
  }

  async exchangeCode(code: string): Promise<OAuthTokenResult> {
    const body = new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: env('GOOGLE_REDIRECT_URI'),
      grant_type: 'authorization_code',
    })
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Google token exchange failed: ${txt}`)
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
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Google token refresh failed: ${txt}`)
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
    const res = await fetch(GOOGLE_PROFILE_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch Google profile: ${res.status}`)
    }
    const data = await res.json() as Record<string, unknown>
    return {
      email: String(data.email ?? ''),
      providerAccountId: String(data.id ?? ''),
      displayName: String(data.name ?? ''),
    }
  }
}
