import { NextRequest, NextResponse } from 'next/server'
import { buildGmailOAuthUrl } from '@/lib/gmail'
import { createClient } from '@/lib/supabase/server'
import pool from '@/lib/db'
import { resolveMailPermissions, hasMailPermission } from '@/lib/mail-permissions'

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('returnTo') || '/engage/accounts'
  const failBase = returnTo.startsWith('/engage') ? '/engage/accounts/add' : returnTo

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const membership = await pool.query<{ organization_id: string; role: string }>(
    `SELECT organization_id, role FROM public.users
     WHERE id = $1 LIMIT 1`,
    [user.id]
  )
  const row = membership.rows[0]
  if (!row) {
    return NextResponse.redirect(
      new URL(`${failBase}?error=${encodeURIComponent('no_organization')}`, req.url)
    )
  }

  const perms = resolveMailPermissions(row.role || 'member')
  if (!hasMailPermission(perms, 'mail.write')) {
    return NextResponse.redirect(
      new URL(`${failBase}?error=${encodeURIComponent('permission_denied')}`, req.url)
    )
  }

  const state = Buffer.from(
    JSON.stringify({
      returnTo: returnTo.startsWith('/') ? returnTo : '/engage/accounts',
      userId: user.id,
      t: Date.now(),
    })
  ).toString('base64url')

  try {
    const url = buildGmailOAuthUrl(state)
    return NextResponse.redirect(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'oauth_start_failed'
    return NextResponse.redirect(
      new URL(`${failBase}?error=${encodeURIComponent(message)}`, req.url)
    )
  }
}
