import * as trackingRepo from '@/repositories/mail/tracking-repository'
import type { TrackingToken, TrackingPixelEvent, ClickEvent, TrackingDashboardStats } from '@/types/deliverability'

export async function generateTrackingToken(data: {
  organizationId: string
  campaignId?: string
  mailboxId?: string
  tokenType: 'open' | 'click'
  recipientEmail?: string
}): Promise<TrackingToken> {
  return trackingRepo.createTrackingToken(data)
}

export async function resolveTrackingToken(token: string): Promise<TrackingToken | null> {
  return trackingRepo.findTrackingToken(token)
}

export async function handlePixelOpen(
  tokenValue: string,
  context: {
    userAgent?: string
    ipAddress?: string
    country?: string
  }
): Promise<{ recorded: boolean; error?: string }> {
  const token = await trackingRepo.findTrackingToken(tokenValue)
  if (!token) return { recorded: false, error: 'Invalid or expired token' }

  await trackingRepo.markTokenUsed(token.id)

  await trackingRepo.recordPixelEvent({
    organizationId: token.organizationId,
    trackingTokenId: token.id,
    campaignId: token.campaignId ?? undefined,
    mailboxId: token.mailboxId ?? undefined,
    recipientEmail: token.recipientEmail ?? 'unknown',
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
    country: context.country,
  })

  return { recorded: true }
}

export async function handleClick(
  tokenValue: string,
  originalUrl: string,
  context: {
    userAgent?: string
    ipAddress?: string
    country?: string
  }
): Promise<{ redirectUrl: string | null; recorded: boolean; error?: string }> {
  const token = await trackingRepo.findTrackingToken(tokenValue)
  if (!token) return { redirectUrl: null, recorded: false, error: 'Invalid or expired token' }

  await trackingRepo.markTokenUsed(token.id)

  await trackingRepo.recordClickEvent({
    organizationId: token.organizationId,
    trackingTokenId: token.id,
    campaignId: token.campaignId ?? undefined,
    mailboxId: token.mailboxId ?? undefined,
    recipientEmail: token.recipientEmail ?? 'unknown',
    originalUrl,
    userAgent: context.userAgent,
    ipAddress: context.ipAddress,
    country: context.country,
  })

  return { redirectUrl: originalUrl, recorded: true }
}

export async function getPixelEvents(campaignId: string, limit?: number): Promise<TrackingPixelEvent[]> {
  return trackingRepo.getPixelEventsByCampaign(campaignId, limit)
}

export async function getClickEvents(campaignId: string, limit?: number): Promise<ClickEvent[]> {
  return trackingRepo.getClickEventsByCampaign(campaignId, limit)
}

export async function getTrackingDashboardStats(orgId: string): Promise<TrackingDashboardStats> {
  return trackingRepo.getTrackingDashboardStats(orgId)
}

function resolveAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://app.magnivo.ai'
  ).replace(/\/$/, '')
}

/**
 * Prefer a verified per-tenant tracking domain when present (PRD §6.7.29).
 * Falls back to the app URL so sends never break without a custom domain.
 */
export async function resolveOrgTrackingOrigin(orgId: string): Promise<{
  origin: string
  trackingDomain: string | null
  enforced: boolean
}> {
  try {
    const { listTrackingDomains } = await import('@/services/mail/tracking-domain-service')
    const domains = await listTrackingDomains(orgId)
    const verified = domains.find((d) => d.status === 'verified')
    if (verified) {
      return {
        origin: `https://${verified.trackingDomain}`,
        trackingDomain: verified.trackingDomain,
        enforced: true,
      }
    }
  } catch {
    // fall through
  }
  return { origin: resolveAppUrl(), trackingDomain: null, enforced: false }
}

export function buildTrackingPixelUrl(
  token: string,
  options?: { absolute?: boolean; origin?: string }
): string {
  const path = `/api/tracking/pixel/${token}`
  if (options?.origin) return `${options.origin.replace(/\/$/, '')}${path}`
  return options?.absolute ? `${resolveAppUrl()}${path}` : path
}

export function buildClickRedirectUrl(
  token: string,
  url: string,
  options?: { absolute?: boolean; origin?: string }
): string {
  const encodedUrl = encodeURIComponent(url)
  const path = `/api/tracking/click/${token}?url=${encodedUrl}`
  if (options?.origin) return `${options.origin.replace(/\/$/, '')}${path}`
  return options?.absolute ? `${resolveAppUrl()}${path}` : path
}

export async function buildOrgTrackingPixelUrl(orgId: string, token: string): Promise<string> {
  const { origin } = await resolveOrgTrackingOrigin(orgId)
  return buildTrackingPixelUrl(token, { origin })
}

export async function buildOrgClickRedirectUrl(
  orgId: string,
  token: string,
  url: string
): Promise<string> {
  const { origin } = await resolveOrgTrackingOrigin(orgId)
  return buildClickRedirectUrl(token, url, { origin })
}
