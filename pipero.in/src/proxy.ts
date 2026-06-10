import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public routes that must remain reachable without a Clerk session.
// - /sign-in, /sign-up: the Clerk auth pages themselves
// - /login: legacy route, redirects to /sign-in
// - the Gmail Pub/Sub webhook: an external Google push that can't carry a Clerk session
// - /api/track/*: email open pixels, click redirects and unsubscribe links are
//   opened by recipients who have no CRM session — they must never hit the wall
// - /api/engage/worker: the campaign worker, pinged by the gtm_service scheduler
//   with its own x-worker-token (no Clerk session)
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/login',
  '/api/engage/gmail/webhook',
  '/api/track/(.*)',
  '/api/engage/worker',
])

export default clerkMiddleware(async (auth, req) => {
  // Local-dev escape hatch: when bypass is on, skip auth entirely (no login wall).
  if (process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true') return

  const { userId } = await auth()

  // Gate everything that isn't public — redirects to /sign-in when signed out.
  if (!userId && !isPublicRoute(req)) {
    await auth.protect()
  }

  // Bridge Clerk → the app's existing session model. The whole CRM resolves the
  // current user/org off the `sb-mock-auth` cookie; keep it in lock-step with the
  // Clerk session so a real Clerk login activates the existing (single-org admin)
  // flow, and a Clerk sign-out tears it down.
  const res = NextResponse.next()
  if (userId) {
    res.cookies.set('sb-mock-auth', 'true', { path: '/', sameSite: 'lax' })
  } else {
    res.cookies.delete('sb-mock-auth')
  }
  return res
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for Clerk's auto-proxy path
    '/__clerk/:path*',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
