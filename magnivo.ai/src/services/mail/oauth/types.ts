import type { OAuthProvider } from '@/types/mail'

export type OAuthTokenResult = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date
  scope: string
  providerAccountId: string
}

export type OAuthProfile = {
  email: string
  providerAccountId: string
  displayName?: string
}

export type OAuthUrls = {
  authorizationUrl: string
  state: string
}

export interface OAuthProviderService {
  readonly provider: OAuthProvider

  getAuthorizationUrl(state: string): string
  exchangeCode(code: string): Promise<OAuthTokenResult>
  refreshToken(refreshToken: string): Promise<OAuthTokenResult>
  getProfile(accessToken: string): Promise<OAuthProfile>
}
