import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { handlePixelOpen } from '@/services/mail/tracking-service'
import { shouldFilterOpen, recordFilteredEvent, isKnownBot } from '@/services/mail/tracking-bot-filter'

const log = createLogger('tracking-pixel')

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

/**
 * Mail-module open tracking pixel (token-based).
 * Legacy Engage opens remain at /api/track/open.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params
  const userAgent = req.headers.get('user-agent') ?? undefined
  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    undefined

  try {
    const filterResult = await shouldFilterOpen(token, { userAgent, ipAddress })
    if (filterResult.filtered) {
      // Still serve the pixel (don't reveal filtering to requester)
      log.info('Open event filtered', { token, reason: filterResult.reason, ua: userAgent?.slice(0, 80) })
      const trackingToken = await (await import('@/repositories/mail/tracking-repository')).findTrackingToken(token)
      if (trackingToken) {
        await recordFilteredEvent({
          organizationId: trackingToken.organizationId,
          tokenId: trackingToken.id,
          eventType: 'open',
          reason: filterResult.reason!,
          userAgent,
          ipAddress,
        }).catch(() => {})
      }
    } else {
      await handlePixelOpen(token, { userAgent, ipAddress })
    }
  } catch (e) {
    log.error('Open tracking failed', { token, error: String(e) })
  }

  return new NextResponse(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
