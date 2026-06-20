import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens, getGoogleProfileEmail } from '@/lib/gmail'
import { upsertGmailMailbox } from '@/app/actions/engage'

export async function GET(req: NextRequest) {
  try {
    const code = req.nextUrl.searchParams.get('code')
    const stateRaw = req.nextUrl.searchParams.get('state')
    if (!code) return NextResponse.redirect(new URL('/engage/settings?error=missing_code', req.url))

    const tokens = await exchangeCodeForTokens(code)
    const email = await getGoogleProfileEmail(tokens.access_token)

    await upsertGmailMailbox({
      email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenType: tokens.token_type,
      scope: tokens.scope,
      expiresIn: tokens.expires_in,
    })

    let returnTo = '/engage/inbox'
    if (stateRaw) {
      try {
        const parsed = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8')) as { returnTo?: string }
        if (parsed?.returnTo?.startsWith('/')) returnTo = parsed.returnTo
      } catch {
        // ignore malformed state
      }
    }
    return NextResponse.redirect(new URL(`${returnTo}?connected=gmail`, req.url))
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'oauth_failed'
    return NextResponse.redirect(new URL(`/engage/settings?error=${encodeURIComponent(message)}`, req.url))
  }
}

