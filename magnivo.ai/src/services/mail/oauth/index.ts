import type { OAuthProvider } from '@/types/mail'
import type { OAuthProviderService } from './types'
import { GoogleOAuthService } from './google'
import { MicrosoftOAuthService } from './microsoft'
import { ZohoOAuthService } from './zoho'

const services: Record<OAuthProvider, () => OAuthProviderService> = {
  gmail: () => new GoogleOAuthService(),
  outlook: () => new MicrosoftOAuthService(),
  zoho: () => new ZohoOAuthService(),
}

export function getOAuthService(provider: OAuthProvider): OAuthProviderService {
  const factory = services[provider]
  if (!factory) throw new Error(`Unsupported OAuth provider: ${provider}`)
  return factory()
}

export type { OAuthProviderService, OAuthTokenResult, OAuthProfile } from './types'
