import type { OAuthProviderService, OAuthTokenResult, OAuthProfile } from './types'

const ZOHO_API_DOMAIN = 'https://accounts.zoho.com'

function env(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is required for Zoho OAuth`)
  return v
}

function getZohoDomain(): string {
  return process.env.ZOHO_API_DOMAIN ?? ZOHO_API_DOMAIN
}

export function getZohoScopes(): string[] {
  return [
    'ZohoMail.accounts.READ',
    'ZohoMail.messages.CREATE',
    'ZohoMail.messages.READ',
    'ZohoMail.folders.READ',
  ]
}

export class ZohoOAuthService implements OAuthProviderService {
  readonly provider = 'zoho' as const

  getAuthorizationUrl(state: string): string {
    const domain = getZohoDomain()
    const params = new URLSearchParams({
      client_id: env('ZOHO_CLIENT_ID'),
      redirect_uri: env('ZOHO_REDIRECT_URI'),
      response_type: 'code',
      scope: getZohoScopes().join(' '),
      state,
      access_type: 'offline',
    })
    return `${domain}/oauth/v2/auth?${params.toString()}`
  }

  async exchangeCode(code: string): Promise<OAuthTokenResult> {
    const domain = getZohoDomain()
    const body = new URLSearchParams({
      code,
      client_id: env('ZOHO_CLIENT_ID'),
      client_secret: env('ZOHO_CLIENT_SECRET'),
      redirect_uri: env('ZOHO_REDIRECT_URI'),
      grant_type: 'authorization_code',
    })
    const res = await fetch(`${domain}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Zoho token exchange failed: ${txt}`)
    }
    const data = await res.json() as Record<string, unknown>
    const accessToken = String(data.access_token ?? '')
    const refreshToken = data.refresh_token ? String(data.refresh_token) : null
    const expiresIn = Number(data.expires_in ?? 3600)
    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scope: String(data.scope ?? ''),
      providerAccountId: '',
    }
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokenResult> {
    const domain = getZohoDomain()
    const body = new URLSearchParams({
      client_id: env('ZOHO_CLIENT_ID'),
      client_secret: env('ZOHO_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })
    const res = await fetch(`${domain}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`Zoho token refresh failed: ${txt}`)
    }
    const data = await res.json() as Record<string, unknown>
    const accessToken = String(data.access_token ?? '')
    const expiresIn = Number(data.expires_in ?? 3600)
    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scope: String(data.scope ?? ''),
      providerAccountId: '',
    }
  }

  async getProfile(accessToken: string): Promise<OAuthProfile> {
    const domain = getZohoDomain()
    const res = await fetch(`${domain}/oauth/user/info`, {
      headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch Zoho profile: ${res.status}`)
    }
    const data = await res.json() as Record<string, unknown>
    const userInfo = (data as Record<string, unknown>).data ?? data
    const info = userInfo as Record<string, unknown>
    return {
      email: String(info.Email ?? ''),
      providerAccountId: String(info.ZUID ?? info.User_xid ?? ''),
      displayName: String(info.DisplayName ?? info.First_Name ?? ''),
    }
  }
}
