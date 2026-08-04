import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { handleClick } from '@/services/mail/tracking-service'
import { shouldFilterClick, recordFilteredEvent } from '@/services/mail/tracking-bot-filter'

const log = createLogger('tracking-click')

/**
 * Mail-module click redirect (token-based).
 * Legacy Engage clicks remain at /api/track/click.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const originalUrl = req.nextUrl.searchParams.get('url') || '/'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined

  try {
    const filterResult = await shouldFilterClick(token, { userAgent, ipAddress })
    if (filterResult.filtered) {
      log.info('Click event filtered', { token, reason: filterResult.reason, ua: userAgent?.slice(0, 80) })
      const trackingToken = await (await import('@/repositories/mail/tracking-repository')).findTrackingToken(token)
      if (trackingToken) {
        await recordFilteredEvent({
          organizationId: trackingToken.organizationId,
          tokenId: trackingToken.id,
          eventType: 'click',
          reason: filterResult.reason!,
          userAgent,
          ipAddress,
        }).catch(() => {})
      }
    } else {
      await handleClick(token, originalUrl, { userAgent, ipAddress })
    }
    const redirectTo = originalUrl
    if (!/^https?:\/\//i.test(redirectTo)) {
      return NextResponse.redirect(new URL('/', req.url), 302)
    }
    return NextResponse.redirect(redirectTo, 302)
  } catch (e) {
    log.error('Click tracking failed', { token, error: String(e) })
    if (/^https?:\/\//i.test(originalUrl)) {
      return NextResponse.redirect(originalUrl, 302)
    }
    return NextResponse.redirect(new URL('/', req.url), 302)
  }
}
