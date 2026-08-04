import pool from '@/lib/db'
import type { TrackingToken, TrackingPixelEvent, ClickEvent, TrackingDashboardStats } from '@/types/deliverability'
import crypto from 'crypto'

function generateToken(): string {
  return crypto.randomBytes(16).toString('hex')
}

export async function createTrackingToken(data: {
  organizationId: string
  campaignId?: string
  mailboxId?: string
  tokenType: 'open' | 'click'
  recipientEmail?: string
  expiresAt?: string
}): Promise<TrackingToken> {
  const result = await pool.query(
    `INSERT INTO public.mail_tracking_tokens
      (organization_id, campaign_id, mailbox_id, token, token_type, recipient_email, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [data.organizationId, data.campaignId ?? null, data.mailboxId ?? null, generateToken(), data.tokenType, data.recipientEmail ?? null, data.expiresAt ?? null]
  )
  return result.rows[0]
}

export async function findTrackingToken(token: string): Promise<TrackingToken | null> {
  const result = await pool.query(
    `SELECT * FROM public.mail_tracking_tokens
     WHERE token = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [token]
  )
  return result.rows[0] ?? null
}

export async function markTokenUsed(tokenId: string): Promise<void> {
  await pool.query(
    `UPDATE public.mail_tracking_tokens SET used_at = NOW() WHERE id = $1`,
    [tokenId]
  )
}

export async function recordPixelEvent(data: {
  organizationId: string
  trackingTokenId: string
  campaignId?: string
  mailboxId?: string
  recipientEmail: string
  userAgent?: string
  ipAddress?: string
  country?: string
}): Promise<TrackingPixelEvent> {
  const result = await pool.query(
    `INSERT INTO public.mail_tracking_pixel_events
      (organization_id, tracking_token_id, campaign_id, mailbox_id, recipient_email, user_agent, ip_address, country)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [data.organizationId, data.trackingTokenId, data.campaignId ?? null, data.mailboxId ?? null, data.recipientEmail, data.userAgent ?? null, data.ipAddress ?? null, data.country ?? null]
  )
  return result.rows[0]
}

export async function recordClickEvent(data: {
  organizationId: string
  trackingTokenId: string
  campaignId?: string
  mailboxId?: string
  recipientEmail: string
  originalUrl: string
  redirectUrl?: string
  userAgent?: string
  ipAddress?: string
  country?: string
}): Promise<ClickEvent> {
  const result = await pool.query(
    `INSERT INTO public.mail_click_events
      (organization_id, tracking_token_id, campaign_id, mailbox_id, recipient_email, original_url, redirect_url, user_agent, ip_address, country)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [data.organizationId, data.trackingTokenId, data.campaignId ?? null, data.mailboxId ?? null, data.recipientEmail, data.originalUrl, data.redirectUrl ?? null, data.userAgent ?? null, data.ipAddress ?? null, data.country ?? null]
  )
  return result.rows[0]
}

export async function getPixelEventsByCampaign(campaignId: string, limit: number = 100): Promise<TrackingPixelEvent[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_tracking_pixel_events
     WHERE campaign_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [campaignId, limit]
  )
  return result.rows
}

export async function getClickEventsByCampaign(campaignId: string, limit: number = 100): Promise<ClickEvent[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_click_events
     WHERE campaign_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [campaignId, limit]
  )
  return result.rows
}

export async function getTrackingDashboardStats(orgId: string): Promise<TrackingDashboardStats> {
  const totalOpensResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_tracking_pixel_events
     WHERE organization_id = $1`,
    [orgId]
  )
  const uniqueOpensResult = await pool.query(
    `SELECT COUNT(DISTINCT recipient_email)::int AS count FROM public.mail_tracking_pixel_events
     WHERE organization_id = $1`,
    [orgId]
  )
  const totalClicksResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_click_events
     WHERE organization_id = $1`,
    [orgId]
  )
  const uniqueClicksResult = await pool.query(
    `SELECT COUNT(DISTINCT recipient_email)::int AS count FROM public.mail_click_events
     WHERE organization_id = $1`,
    [orgId]
  )

  const totalOpens = totalOpensResult.rows[0]?.count ?? 0
  const uniqueOpens = uniqueOpensResult.rows[0]?.count ?? 0
  const totalClicks = totalClicksResult.rows[0]?.count ?? 0
  const uniqueClicks = uniqueClicksResult.rows[0]?.count ?? 0

  const totalRecipientsResult = await pool.query(
    `SELECT COUNT(DISTINCT recipient_email)::int AS count FROM public.mail_tracking_tokens
     WHERE organization_id = $1`,
    [orgId]
  )
  const totalRecipients = totalRecipientsResult.rows[0]?.count ?? 1

  const recentPixelEvents = await pool.query(
    `SELECT * FROM public.mail_tracking_pixel_events
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [orgId]
  )
  const recentClickEvents = await pool.query(
    `SELECT * FROM public.mail_click_events
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [orgId]
  )

  return {
    totalOpens,
    uniqueOpens,
    totalClicks,
    uniqueClicks,
    openRate: totalRecipients > 0 ? uniqueOpens / totalRecipients : 0,
    clickRate: totalRecipients > 0 ? uniqueClicks / totalRecipients : 0,
    recentEvents: [...recentPixelEvents.rows, ...recentClickEvents.rows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    ).slice(0, 10),
  }
}
