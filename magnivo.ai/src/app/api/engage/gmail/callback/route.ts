import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/gmail'
import { createClient } from '@/lib/supabase/server'
import pool from '@/lib/db'
import { completeGmailOAuthConnect } from '@/services/mail/gmail-connect-service'
import { resolveMailPermissions, hasMailPermission } from '@/lib/mail-permissions'

async function resolveOrgAndRole(userId: string): Promise<{ orgId: string; role: string } | null> {
  const r = await pool.query<{ organization_id: string; role: string }>(
    `SELECT organization_id, role FROM public.users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  )
  const row = r.rows[0]
  if (!row) return null
  return { orgId: row.organization_id, role: row.role || 'member' }
}

export async function GET(req: NextRequest) {
  const errorParam = req.nextUrl.searchParams.get('error')
  const stateRaw = req.nextUrl.searchParams.get('state')

  let returnTo = '/engage/accounts'
  if (stateRaw) {
    try {
      const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) as {
        returnTo?: string
      }
      if (parsed?.returnTo?.startsWith('/')) returnTo = parsed.returnTo
    } catch {
      // ignore
    }
  }

  const fail = (msg: string) =>
    NextResponse.redirect(
      new URL(
        `${returnTo.startsWith('/engage') ? (returnTo.includes('/add') ? returnTo : '/engage/accounts/add') : returnTo}?error=${encodeURIComponent(msg)}`,
        req.url
      )
    )

  // Consent denied — no partial mailbox (PRD §15)
  if (errorParam) {
    return fail(errorParam === 'access_denied' ? 'oauth_denied' : errorParam)
  }

  try {
    const code = req.nextUrl.searchParams.get('code')
    if (!code) return fail('missing_code')

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return fail('unauthenticated')

    const membership = await resolveOrgAndRole(user.id)
    if (!membership) return fail('no_organization')

    const perms = resolveMailPermissions(membership.role)
    if (!hasMailPermission(perms, 'mail.write')) {
      return fail('permission_denied')
    }

    const tokens = await exchangeCodeForTokens(code)
    const result = await completeGmailOAuthConnect({
      userId: user.id,
      orgId: membership.orgId,
      actorEmail: user.email || '',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      scope: tokens.scope,
      expiresIn: tokens.expires_in,
    })

    if (!result.success) {
      return fail(result.error || 'oauth_failed')
    }

    const successUrl = new URL(returnTo.startsWith('/') ? returnTo : '/engage/accounts', req.url)
    successUrl.searchParams.set('connected', 'gmail')
    successUrl.searchParams.set('email', result.data.email)
    successUrl.searchParams.set('status', 'connected')
    if (result.data.verification.inboxReadOk) {
      successUrl.searchParams.set('verified', '1')
    }
    return NextResponse.redirect(successUrl)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'oauth_failed'
    return fail(message)
  }
}
