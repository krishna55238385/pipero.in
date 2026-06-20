import { NextRequest, NextResponse } from 'next/server'
import { buildGmailOAuthUrl } from '@/lib/gmail'

export async function GET(req: NextRequest) {
  const returnTo = req.nextUrl.searchParams.get('returnTo') || '/engage/inbox'
  const state = Buffer.from(JSON.stringify({ returnTo, t: Date.now() })).toString('base64url')
  const url = buildGmailOAuthUrl(state)
  return NextResponse.redirect(url)
}

