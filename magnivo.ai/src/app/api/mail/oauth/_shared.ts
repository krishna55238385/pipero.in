import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import pool from '@/lib/db'
import { createMailboxWithOAuth } from '@/services/mail/mailbox-service'
import { completeGmailOAuthConnect } from '@/services/mail/gmail-connect-service'
import { completeOutlookOAuthConnect } from '@/services/mail/outlook-connect-service'
import { completeZohoOAuthConnect } from '@/services/mail/zoho-connect-service'
import { getOAuthService } from '@/services/mail/oauth'
import type { OAuthProvider } from '@/types/mail'

type OAuthState = {
  returnTo?: string
  displayName?: string
  senderName?: string
  timezone?: string
  dailyLimit?: number
  poolId?: string | null
  userId?: string
  syncToEngage?: boolean
}

function parseState(stateRaw: string | null): OAuthState {
  if (!stateRaw) return {}
  try {
    return JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) as OAuthState
  } catch {
    return {}
  }
}

async function resolveOrgId(userId: string): Promise<string | null> {
  const r = await pool.query<{ organization_id: string }>(
    `SELECT organization_id FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  )
  return r.rows[0]?.organization_id ?? null
}

/**
 * Shared OAuth callback for mail-module providers (gmail/outlook/zoho).
 * Creates mail_mailboxes row; dual-writes engage_mailboxes when returnTo is under /engage.
 * Gmail/Outlook use verified connect services (profile + inbox read).
 */
export async function handleMailOAuthCallback(
  req: NextRequest,
  provider: OAuthProvider
): Promise<NextResponse> {
  const stateRaw = req.nextUrl.searchParams.get('state')
  const state = parseState(stateRaw)
  const errorBase =
    state.returnTo && state.returnTo.startsWith('/engage')
      ? '/engage/accounts/add'
      : '/mail/mailboxes/add'

  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`${errorBase}?error=${encodeURIComponent(msg)}`, req.url))

  try {
    const code = req.nextUrl.searchParams.get('code')
    const error = req.nextUrl.searchParams.get('error')

    if (error) {
      return fail(error === 'access_denied' ? 'oauth_denied' : error)
    }
    if (!code) return fail('missing_code')

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return fail('unauthenticated')

    const orgId = await resolveOrgId(user.id)
    if (!orgId) return fail('no_organization')

    const syncToEngage =
      state.syncToEngage === true ||
      Boolean(state.returnTo && state.returnTo.startsWith('/engage'))

    const returnTo =
      state.returnTo && state.returnTo.startsWith('/')
        ? state.returnTo
        : '/mail/mailboxes'

    if (provider === 'gmail' && syncToEngage) {
      const oauth = getOAuthService('gmail')
      const tokens = await oauth.exchangeCode(code)
      const result = await completeGmailOAuthConnect({
        userId: state.userId || user.id,
        orgId,
        actorEmail: user.email || '',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        scope: tokens.scope,
        expiresIn: Math.max(
          60,
          Math.round((tokens.expiresAt.getTime() - Date.now()) / 1000)
        ),
      })
      if (!result.success) return fail(result.error || 'oauth_failed')
      const url = new URL(returnTo, req.url)
      url.searchParams.set('connected', 'gmail')
      url.searchParams.set('email', result.data.email)
      url.searchParams.set('status', 'connected')
      if (result.data.verification.inboxReadOk) url.searchParams.set('verified', '1')
      return NextResponse.redirect(url)
    }

    if (provider === 'outlook') {
      const oauth = getOAuthService('outlook')
      const tokens = await oauth.exchangeCode(code)
      const result = await completeOutlookOAuthConnect({
        userId: state.userId || user.id,
        orgId,
        actorEmail: user.email || '',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        scope: tokens.scope,
        expiresIn: Math.max(
          60,
          Math.round((tokens.expiresAt.getTime() - Date.now()) / 1000)
        ),
      })
      if (!result.success) return fail(result.error || 'oauth_failed')
      const url = new URL(returnTo, req.url)
      url.searchParams.set('connected', 'outlook')
      url.searchParams.set('email', result.data.email)
      url.searchParams.set('status', 'connected')
      if (result.data.verification.inboxReadOk) url.searchParams.set('verified', '1')
      return NextResponse.redirect(url)
    }

    if (provider === 'zoho') {
      const oauth = getOAuthService('zoho')
      const tokens = await oauth.exchangeCode(code)
      const result = await completeZohoOAuthConnect({
        userId: state.userId || user.id,
        orgId,
        actorEmail: user.email || '',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        scope: tokens.scope,
        expiresIn: Math.max(
          60,
          Math.round((tokens.expiresAt.getTime() - Date.now()) / 1000)
        ),
      })
      if (!result.success) return fail(result.error || 'oauth_failed')
      const url = new URL(returnTo, req.url)
      url.searchParams.set('connected', 'zoho')
      url.searchParams.set('email', result.data.email)
      url.searchParams.set('status', 'connected')
      if (result.data.verification.inboxReadOk) url.searchParams.set('verified', '1')
      return NextResponse.redirect(url)
    }

    const result = await createMailboxWithOAuth({
      orgId,
      email: '',
      displayName: state.displayName || '',
      senderName: state.senderName || '',
      provider,
      timezone: state.timezone || 'UTC',
      dailyLimit: state.dailyLimit ?? 50,
      poolId: state.poolId ?? null,
      oauthCode: code,
      userId: state.userId || user.id,
      syncToEngage,
    })

    if (!result.success) {
      return fail(result.error || 'oauth_failed')
    }

    return NextResponse.redirect(
      new URL(`${returnTo}?connected=${provider}&id=${result.data?.id ?? ''}`, req.url)
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'oauth_failed'
    console.error(`[mail/oauth/${provider}]`, message)
    return fail(message)
  }
}
