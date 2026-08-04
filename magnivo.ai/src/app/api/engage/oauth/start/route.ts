import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOAuthService } from '@/services/mail/oauth'
import type { OAuthProvider } from '@/types/mail'

const PROVIDERS: OAuthProvider[] = ['gmail', 'outlook', 'zoho']

/**
 * Starts OAuth for Engage Accounts add flow.
 * Uses mail-module redirect URIs (env) and dual-writes engage_mailboxes on callback.
 */
export async function GET(req: NextRequest) {
  const providerRaw = (req.nextUrl.searchParams.get('provider') || '').toLowerCase()
  const provider = (providerRaw === 'microsoft' ? 'outlook' : providerRaw) as OAuthProvider
  const returnTo = req.nextUrl.searchParams.get('returnTo') || '/engage/accounts'

  if (!PROVIDERS.includes(provider)) {
    return NextResponse.redirect(
      new URL(`/engage/accounts/add?error=${encodeURIComponent('unsupported_provider')}`, req.url)
    )
  }

  // Gmail Engage path is already proven via dedicated engage Gmail OAuth
  if (provider === 'gmail') {
    return NextResponse.redirect(
      new URL(`/api/engage/gmail/connect?returnTo=${encodeURIComponent(returnTo)}`, req.url)
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  try {
    const service = getOAuthService(provider)
    const state = Buffer.from(
      JSON.stringify({
        returnTo: returnTo.startsWith('/') ? returnTo : '/engage/accounts',
        userId: user.id,
        syncToEngage: true,
        t: Date.now(),
      })
    ).toString('base64url')
    const url = service.getAuthorizationUrl(state)
    return NextResponse.redirect(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'oauth_start_failed'
    return NextResponse.redirect(
      new URL(`/engage/accounts/add?error=${encodeURIComponent(message)}`, req.url)
    )
  }
}
