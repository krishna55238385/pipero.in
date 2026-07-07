import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET as string

// Public routes that must remain reachable without a session.
// - /login, /register: the auth pages themselves
// - /api/auth/*: login/register/logout endpoints
// - the Gmail Pub/Sub webhook: an external Google push that can't carry a session
// - /api/track/*: email open pixels, click redirects and unsubscribe links are
//   opened by recipients who have no CRM session — they must never hit the wall
// - /api/engage/worker: the campaign worker, pinged by the gtm_service scheduler
//   with its own x-worker-token (no session)
const PUBLIC_PATHS = [
  /^\/login$/,
  /^\/register$/,
  /^\/api\/auth\/.*/,
  /^\/api\/engage\/gmail\/webhook$/,
  /^\/api\/track\/.*/,
  /^\/api\/engage\/worker$/,
]

function isPublicRoute(pathname: string) {
  return PUBLIC_PATHS.some((re) => re.test(pathname))
}

export default function middleware(req: NextRequest) {
  // Local-dev escape hatch: when bypass is on, skip auth entirely (no login wall).
  if (process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true') return NextResponse.next()

  const { pathname } = req.nextUrl
  if (isPublicRoute(pathname)) return NextResponse.next()

  const token = req.cookies.get('magnivo_token')?.value
  let valid = false
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET)
      valid = true
    } catch {
      valid = false
    }
  }

  if (!valid) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
