import pool from '@/lib/db'
import type {
  AnalyticsOverview,
  AnalyticsTimeSeriesPoint,
  CampaignAnalyticsRow,
  MailAnalyticsDashboard,
  MailboxAnalyticsRow,
  MailboxHealthAnalyticsRow,
  PlacementAnalyticsPoint,
} from '@/types/mail'

function pct1(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0
}

export async function getMailAnalyticsOverview(
  orgId: string,
  days = 30
): Promise<AnalyticsOverview> {
  const dayInterval = `${Math.max(1, Math.min(365, days))} days`
  const [campaignTotals, usageSeries, engageFallback, unsubTotals] = await Promise.all([
    pool.query<{
      sent: string
      opened: string
      clicked: string
      replied: string
      bounced: string
      unsubscribed: string
    }>(
      `SELECT
         COALESCE(SUM(sent_count), 0)::text AS sent,
         COALESCE(SUM(open_count), 0)::text AS opened,
         COALESCE(SUM(click_count), 0)::text AS clicked,
         COALESCE(SUM(reply_count), 0)::text AS replied,
         COALESCE(SUM(bounce_count), 0)::text AS bounced,
         COALESCE(SUM(unsubscribe_count), 0)::text AS unsubscribed
       FROM public.campaigns
       WHERE organization_id = $1 AND is_deleted = FALSE`,
      [orgId]
    ).catch(() => ({
      rows: [{ sent: '0', opened: '0', clicked: '0', replied: '0', bounced: '0', unsubscribed: '0' }],
    })),
    pool.query<{
      usage_date: string
      sends: number
      opens: number
      clicks: number
      replies: number
      bounces: number
    }>(
      `SELECT usage_date::text, SUM(sends)::int AS sends, SUM(opens)::int AS opens,
              SUM(clicks)::int AS clicks, SUM(replies)::int AS replies, SUM(bounces)::int AS bounces
       FROM public.mail_mailbox_usage_daily
       WHERE organization_id = $1 AND usage_date >= CURRENT_DATE - $2::interval
       GROUP BY usage_date
       ORDER BY usage_date ASC`,
      [orgId, dayInterval]
    ).catch(() => ({ rows: [] })),
    pool.query<{
      sent: string
      opened: string
      clicked: string
      replied: string
      bounced: string
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'sent')::text AS sent,
         COUNT(*) FILTER (WHERE event_type = 'opened')::text AS opened,
         COUNT(*) FILTER (WHERE event_type = 'clicked')::text AS clicked,
         COUNT(*) FILTER (WHERE event_type = 'replied')::text AS replied,
         COUNT(*) FILTER (WHERE event_type = 'bounced')::text AS bounced
       FROM public.engage_campaign_events
       WHERE organization_id = $1
         AND created_at >= NOW() - $2::interval`,
      [orgId, dayInterval]
    ).catch(() => ({ rows: [{ sent: '0', opened: '0', clicked: '0', replied: '0', bounced: '0' }] })),
    pool.query<{ unsubscribed: string }>(
      `SELECT COALESCE(SUM(unsubscribes), 0)::text AS unsubscribed
       FROM public.mail_mailbox_usage_daily
       WHERE organization_id = $1 AND usage_date >= CURRENT_DATE - $2::interval`,
      [orgId, dayInterval]
    ).catch(() => ({ rows: [{ unsubscribed: '0' }] })),
  ])

  const c = campaignTotals.rows[0]
  const e = engageFallback.rows[0]
  const totalSent = Number(c?.sent || 0) + Number(e?.sent || 0)
  const totalOpened = Number(c?.opened || 0) + Number(e?.opened || 0)
  const totalClicked = Number(c?.clicked || 0) + Number(e?.clicked || 0)
  const totalReplied = Number(c?.replied || 0) + Number(e?.replied || 0)
  const totalBounced = Number(c?.bounced || 0) + Number(e?.bounced || 0)
  const totalUnsubscribed = Number(c?.unsubscribed || 0) + Number(unsubTotals.rows[0]?.unsubscribed || 0)
  const totalDelivered = Math.max(0, totalSent - totalBounced)

  const timeSeries: AnalyticsTimeSeriesPoint[] = usageSeries.rows.map((r) => ({
    date: r.usage_date,
    sent: r.sends,
    delivered: Math.max(0, r.sends - r.bounces),
    opened: r.opens,
    clicked: r.clicks,
    replied: r.replies,
    bounced: r.bounces,
  }))

  const denom = totalSent || 1
  return {
    totalSent,
    totalDelivered,
    totalOpened,
    totalClicked,
    totalReplied,
    totalBounced,
    totalUnsubscribed,
    openRate: totalOpened / denom,
    clickRate: totalClicked / denom,
    replyRate: totalReplied / denom,
    bounceRate: totalBounced / denom,
    deliveryRate: totalDelivered / denom,
    timeSeries,
  }
}

export async function getMailboxAnalytics(orgId: string, mailboxId: string) {
  const result = await pool.query(
    `SELECT usage_date::text AS date, sends, opens, clicks, replies, bounces, unsubscribes, warmup_sends
     FROM public.mail_mailbox_usage_daily
     WHERE organization_id = $1 AND mailbox_id = $2
     ORDER BY usage_date DESC
     LIMIT 90`,
    [orgId, mailboxId]
  )
  return result.rows
}

/** Per-campaign metrics including delivered (PRD §6.7.01–03). */
export async function listCampaignAnalytics(orgId: string): Promise<CampaignAnalyticsRow[]> {
  const result = await pool
    .query<{
      id: string
      name: string
      status: string
      sent: string
      opened: string
      clicked: string
      replied: string
      bounced: string
      unsubscribed: string
    }>(
      `SELECT id, name, status::text,
              COALESCE(sent_count, 0)::text AS sent,
              COALESCE(open_count, 0)::text AS opened,
              COALESCE(click_count, 0)::text AS clicked,
              COALESCE(reply_count, 0)::text AS replied,
              COALESCE(bounce_count, 0)::text AS bounced,
              COALESCE(unsubscribe_count, 0)::text AS unsubscribed
       FROM public.campaigns
       WHERE organization_id = $1 AND is_deleted = FALSE
       ORDER BY updated_at DESC
       LIMIT 200`,
      [orgId]
    )
    .catch(() => ({ rows: [] as Array<{
      id: string
      name: string
      status: string
      sent: string
      opened: string
      clicked: string
      replied: string
      bounced: string
      unsubscribed: string
    }> }))

  return result.rows.map((r) => {
    const sent = Number(r.sent)
    const bounced = Number(r.bounced)
    const opened = Number(r.opened)
    const clicked = Number(r.clicked)
    const replied = Number(r.replied)
    const unsubscribed = Number(r.unsubscribed)
    const delivered = Math.max(0, sent - bounced)
    return {
      campaignId: r.id,
      name: r.name,
      status: r.status,
      sent,
      delivered,
      opened,
      clicked,
      replied,
      bounced,
      unsubscribed,
      openRate: pct1(opened, sent),
      clickRate: pct1(clicked, sent),
      replyRate: pct1(replied, sent),
      bounceRate: pct1(bounced, sent),
    }
  })
}

/** Per-mailbox metrics for analytics dashboard (PRD §6.7.04 / §13.G). */
export async function listMailboxAnalyticsBreakdown(
  orgId: string,
  days = 30
): Promise<MailboxAnalyticsRow[]> {
  const dayInterval = `${Math.max(1, Math.min(365, days))} days`
  const result = await pool
    .query<{
      mailbox_id: string
      email: string
      sends: string
      opens: string
      clicks: string
      replies: string
      bounces: string
    }>(
      `SELECT m.id AS mailbox_id, m.email,
              COALESCE(SUM(u.sends), 0)::text AS sends,
              COALESCE(SUM(u.opens), 0)::text AS opens,
              COALESCE(SUM(u.clicks), 0)::text AS clicks,
              COALESCE(SUM(u.replies), 0)::text AS replies,
              COALESCE(SUM(u.bounces), 0)::text AS bounces
       FROM public.mail_mailboxes m
       LEFT JOIN public.mail_mailbox_usage_daily u
         ON u.mailbox_id = m.id AND u.organization_id = m.organization_id
         AND u.usage_date >= CURRENT_DATE - $2::interval
       WHERE m.organization_id = $1 AND m.deleted_at IS NULL
       GROUP BY m.id, m.email
       ORDER BY COALESCE(SUM(u.sends), 0) DESC
       LIMIT 100`,
      [orgId, dayInterval]
    )
    .catch(() => ({ rows: [] as Array<{
      mailbox_id: string
      email: string
      sends: string
      opens: string
      clicks: string
      replies: string
      bounces: string
    }> }))

  return result.rows.map((r) => {
    const sends = Number(r.sends)
    const opens = Number(r.opens)
    const bounces = Number(r.bounces)
    return {
      mailboxId: r.mailbox_id,
      email: r.email,
      sends,
      opens,
      clicks: Number(r.clicks),
      replies: Number(r.replies),
      bounces,
      bounceRate: pct1(bounces, sends),
      openRate: pct1(opens, sends),
    }
  })
}

/** Mailbox health: bounce/complaint/reputation (PRD §6.7.06 / §6.7.16). */
export async function listMailboxHealthAnalytics(orgId: string): Promise<MailboxHealthAnalyticsRow[]> {
  const result = await pool
    .query<{
      mailbox_id: string
      email: string
      status: string
      health_score: number | null
      sends7d: string
      bounces7d: string
      complaints7d: string
      reputation_score: number | null
      reputation_level: string | null
    }>(
      `SELECT m.id AS mailbox_id, m.email, m.mailbox_status::text AS status,
              m.health_score,
              COALESCE(SUM(u.sends), 0)::text AS sends7d,
              COALESCE(SUM(u.bounces), 0)::text AS bounces7d,
              COALESCE((
                SELECT COUNT(*)::int FROM public.mail_complaint_records c
                WHERE c.organization_id = m.organization_id AND c.mailbox_id = m.id
                  AND c.created_at >= NOW() - INTERVAL '7 days'
              ), 0)::text AS complaints7d,
              (
                SELECT r.reputation_score FROM public.mail_mailbox_reputation r
                WHERE r.organization_id = m.organization_id AND r.mailbox_id = m.id
                ORDER BY r.recorded_at DESC LIMIT 1
              ) AS reputation_score,
              (
                SELECT r.reputation_level::text FROM public.mail_mailbox_reputation r
                WHERE r.organization_id = m.organization_id AND r.mailbox_id = m.id
                ORDER BY r.recorded_at DESC LIMIT 1
              ) AS reputation_level
       FROM public.mail_mailboxes m
       LEFT JOIN public.mail_mailbox_usage_daily u
         ON u.mailbox_id = m.id AND u.organization_id = m.organization_id
         AND u.usage_date >= CURRENT_DATE - INTERVAL '7 days'
       WHERE m.organization_id = $1 AND m.deleted_at IS NULL
       GROUP BY m.id, m.email, m.mailbox_status, m.health_score, m.organization_id
       ORDER BY m.email ASC
       LIMIT 100`,
      [orgId]
    )
    .catch(() => ({ rows: [] as Array<{
      mailbox_id: string
      email: string
      status: string
      health_score: number | null
      sends7d: string
      bounces7d: string
      complaints7d: string
      reputation_score: number | null
      reputation_level: string | null
    }> }))

  return result.rows.map((r) => {
    const sends7d = Number(r.sends7d)
    const bounces7d = Number(r.bounces7d)
    const complaints7d = Number(r.complaints7d)
    return {
      mailboxId: r.mailbox_id,
      email: r.email,
      status: r.status,
      healthScore: Number(r.health_score ?? 0),
      sends7d,
      bounces7d,
      bounceRate7d: pct1(bounces7d, sends7d),
      complaints7d,
      complaintRate7d: pct1(complaints7d, sends7d),
      reputationScore: r.reputation_score,
      reputationLevel: r.reputation_level,
    }
  })
}

/** Inbox vs spam placement analytics (PRD §6.7.30–31). */
export async function getPlacementAnalytics(
  orgId: string,
  days = 30
): Promise<PlacementAnalyticsPoint[]> {
  const { getWarmupPlacementSeries } = await import('@/services/mail/warmup-analytics-service')
  const series = await getWarmupPlacementSeries(orgId, days)
  return series.map((p) => {
    const total = p.inbox + p.spam + p.unknown
    return {
      date: p.date,
      inbox: p.inbox,
      spam: p.spam,
      unknown: p.unknown,
      inboxRate: p.inboxRate,
      spamRate: total > 0 ? Math.round((p.spam / total) * 1000) / 10 : 0,
    }
  })
}

export async function incrementMailboxUsage(
  orgId: string,
  mailboxId: string,
  deltas: Partial<{
    sends: number
    opens: number
    clicks: number
    replies: number
    bounces: number
    unsubscribes: number
    warmup_sends: number
  }>
): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_mailbox_usage_daily
      (organization_id, mailbox_id, usage_date, sends, opens, clicks, replies, bounces, unsubscribes, warmup_sends)
     VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (mailbox_id, usage_date) DO UPDATE SET
       sends = public.mail_mailbox_usage_daily.sends + EXCLUDED.sends,
       opens = public.mail_mailbox_usage_daily.opens + EXCLUDED.opens,
       clicks = public.mail_mailbox_usage_daily.clicks + EXCLUDED.clicks,
       replies = public.mail_mailbox_usage_daily.replies + EXCLUDED.replies,
       bounces = public.mail_mailbox_usage_daily.bounces + EXCLUDED.bounces,
       unsubscribes = public.mail_mailbox_usage_daily.unsubscribes + EXCLUDED.unsubscribes,
       warmup_sends = public.mail_mailbox_usage_daily.warmup_sends + EXCLUDED.warmup_sends,
       updated_at = NOW()`,
    [
      orgId,
      mailboxId,
      deltas.sends ?? 0,
      deltas.opens ?? 0,
      deltas.clicks ?? 0,
      deltas.replies ?? 0,
      deltas.bounces ?? 0,
      deltas.unsubscribes ?? 0,
      deltas.warmup_sends ?? 0,
    ]
  )
}

export async function exportAnalyticsCsv(orgId: string, days = 30): Promise<string> {
  const overview = await getMailAnalyticsOverview(orgId, days)
  const lines = ['date,sent,delivered,opened,clicked,replied,bounced']
  for (const point of overview.timeSeries) {
    lines.push(
      `${point.date},${point.sent},${point.delivered},${point.opened},${point.clicked},${point.replied},${point.bounced}`
    )
  }
  lines.push('')
  lines.push(`total_sent,${overview.totalSent}`)
  lines.push(`total_delivered,${overview.totalDelivered}`)
  lines.push(`total_opened,${overview.totalOpened}`)
  lines.push(`total_clicked,${overview.totalClicked}`)
  lines.push(`total_replied,${overview.totalReplied}`)
  lines.push(`total_bounced,${overview.totalBounced}`)
  lines.push(`total_unsubscribed,${overview.totalUnsubscribed}`)
  return lines.join('\n')
}

/** Raw engagement event export (PRD §6.7.07). */
export async function exportRawAnalyticsEventsCsv(orgId: string, days = 30): Promise<string> {
  const dayInterval = `${Math.max(1, Math.min(365, days))} days`
  const lines = ['source,event_type,occurred_at,campaign_id,mailbox_id,recipient_email,metadata']

  const [engageEvents, pixelEvents, clickEvents, bounces] = await Promise.all([
    pool
      .query<{
        event_type: string
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        recipient_email: string | null
      }>(
        `SELECT event_type, created_at::text, campaign_id::text, mailbox_id::text, recipient_email
         FROM public.engage_campaign_events
         WHERE organization_id = $1 AND created_at >= NOW() - $2::interval
         ORDER BY created_at DESC
         LIMIT 5000`,
        [orgId, dayInterval]
      )
      .catch(() => ({ rows: [] as Array<{
        event_type: string
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        recipient_email: string | null
      }> })),
    pool
      .query<{
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        recipient_email: string
      }>(
        `SELECT pe.created_at::text, pe.campaign_id::text, pe.mailbox_id::text, pe.recipient_email
         FROM public.mail_tracking_pixel_events pe
         WHERE pe.organization_id = $1 AND pe.created_at >= NOW() - $2::interval
         ORDER BY pe.created_at DESC
         LIMIT 5000`,
        [orgId, dayInterval]
      )
      .catch(() => ({ rows: [] as Array<{
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        recipient_email: string
      }> })),
    pool
      .query<{
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        recipient_email: string
        original_url: string
      }>(
        `SELECT ce.created_at::text, ce.campaign_id::text, ce.mailbox_id::text, ce.recipient_email, ce.original_url
         FROM public.mail_tracking_click_events ce
         WHERE ce.organization_id = $1 AND ce.created_at >= NOW() - $2::interval
         ORDER BY ce.created_at DESC
         LIMIT 5000`,
        [orgId, dayInterval]
      )
      .catch(() => ({ rows: [] as Array<{
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        recipient_email: string
        original_url: string
      }> })),
    pool
      .query<{
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        email: string
        bounce_type: string
      }>(
        `SELECT created_at::text, campaign_id::text, mailbox_id::text, recipient_email AS email, bounce_type::text
         FROM public.mail_bounce_records
         WHERE organization_id = $1 AND created_at >= NOW() - $2::interval
         ORDER BY created_at DESC
         LIMIT 5000`,
        [orgId, dayInterval]
      )
      .catch(() => ({ rows: [] as Array<{
        created_at: string
        campaign_id: string | null
        mailbox_id: string | null
        email: string
        bounce_type: string
      }> })),
  ])

  const esc = (v: string | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`

  for (const e of engageEvents.rows) {
    lines.push(
      ['engage', e.event_type, e.created_at, e.campaign_id, e.mailbox_id, e.recipient_email, '']
        .map(esc)
        .join(',')
    )
  }
  for (const e of pixelEvents.rows) {
    lines.push(
      ['pixel', 'opened', e.created_at, e.campaign_id, e.mailbox_id, e.recipient_email, '']
        .map(esc)
        .join(',')
    )
  }
  for (const e of clickEvents.rows) {
    lines.push(
      ['click', 'clicked', e.created_at, e.campaign_id, e.mailbox_id, e.recipient_email, e.original_url]
        .map(esc)
        .join(',')
    )
  }
  for (const e of bounces.rows) {
    lines.push(
      ['bounce', e.bounce_type, e.created_at, e.campaign_id, e.mailbox_id, e.email, '']
        .map(esc)
        .join(',')
    )
  }

  return lines.join('\n')
}

export function buildAnalyticsRiskAndRecommendations(input: {
  bounceRate: number
  complaintMailboxes: number
  openRate: number
  spamRate: number
  suspendedMailboxes: number
}): { riskScore: number; recommendations: string[] } {
  let risk = 20
  const recommendations: string[] = []

  if (input.bounceRate > 0.05) {
    risk += 25
    recommendations.push('Bounce rate exceeds 5%. Pause risky mailboxes and scrub lists.')
  } else if (input.bounceRate > 0.02) {
    risk += 12
    recommendations.push('Bounce rate is elevated. Tighten verification before next launch.')
  }

  if (input.complaintMailboxes > 0) {
    risk += 20
    recommendations.push('Complaint activity detected. Review content and suppress complainants.')
  }

  if (input.openRate < 0.1 && input.openRate > 0) {
    risk += 10
    recommendations.push('Open rate is low. Improve subjects and mailbox reputation before scaling.')
  }

  if (input.spamRate > 20) {
    risk += 15
    recommendations.push('Spam placement is high in warmup. Reduce volume and reinforce spam rescue.')
  }

  if (input.suspendedMailboxes > 0) {
    risk += 10
    recommendations.push(`${input.suspendedMailboxes} mailbox(es) suspended — reconnect or resume after health recovery.`)
  }

  if (recommendations.length === 0) {
    recommendations.push('Deliverability looks stable. Continue gradual volume increases.')
  }

  return { riskScore: Math.min(100, Math.max(0, risk)), recommendations }
}

export async function getMailAnalyticsDashboard(
  orgId: string,
  days = 30
): Promise<MailAnalyticsDashboard> {
  const [overview, campaigns, mailboxes, mailboxHealth, placement] = await Promise.all([
    getMailAnalyticsOverview(orgId, days),
    listCampaignAnalytics(orgId),
    listMailboxAnalyticsBreakdown(orgId, days),
    listMailboxHealthAnalytics(orgId),
    getPlacementAnalytics(orgId, days),
  ])

  const spamTotal = placement.reduce((a, p) => a + p.spam, 0)
  const placeTotal = placement.reduce((a, p) => a + p.inbox + p.spam + p.unknown, 0)
  const { riskScore, recommendations } = buildAnalyticsRiskAndRecommendations({
    bounceRate: overview.bounceRate,
    complaintMailboxes: mailboxHealth.filter((m) => m.complaints7d > 0).length,
    openRate: overview.openRate,
    spamRate: placeTotal > 0 ? (spamTotal / placeTotal) * 100 : 0,
    suspendedMailboxes: mailboxHealth.filter((m) =>
      ['suspended', 'reconnect_required', 'at_risk'].includes(m.status)
    ).length,
  })

  return {
    overview,
    campaigns,
    mailboxes,
    mailboxHealth,
    placement,
    periodDays: days,
    riskScore,
    recommendations,
  }
}

/** Aggregate usage into daily / weekly / monthly buckets (PRD §6.7.21). */
export async function getPeriodUsageReport(
  orgId: string,
  period: 'daily' | 'weekly' | 'monthly'
): Promise<Array<{ period: string; sent: number; opened: number; clicked: number; replied: number; bounced: number }>> {
  const trunc =
    period === 'monthly' ? 'month' : period === 'weekly' ? 'week' : 'day'
  const lookback = period === 'monthly' ? '365 days' : period === 'weekly' ? '180 days' : '90 days'

  const result = await pool
    .query<{
      bucket: string
      sends: number
      opens: number
      clicks: number
      replies: number
      bounces: number
    }>(
      `SELECT date_trunc($2, usage_date)::date::text AS bucket,
              SUM(sends)::int AS sends, SUM(opens)::int AS opens,
              SUM(clicks)::int AS clicks, SUM(replies)::int AS replies, SUM(bounces)::int AS bounces
       FROM public.mail_mailbox_usage_daily
       WHERE organization_id = $1 AND usage_date >= CURRENT_DATE - $3::interval
       GROUP BY 1
       ORDER BY 1 ASC`,
      [orgId, trunc, lookback]
    )
    .catch(() => ({ rows: [] as Array<{
      bucket: string
      sends: number
      opens: number
      clicks: number
      replies: number
      bounces: number
    }> }))

  return result.rows.map((r) => ({
    period: r.bucket,
    sent: r.sends,
    opened: r.opens,
    clicked: r.clicks,
    replied: r.replies,
    bounced: r.bounces,
  }))
}

export type CampaignEventReconciliation = {
  campaignId: string
  reported: {
    sent: number
    opened: number
    clicked: number
    replied: number
    bounced: number
  }
  observed: {
    sent: number
    opened: number
    clicked: number
    replied: number
    bounced: number
    inFlight: number
  }
  balanced: boolean
  discrepancies: string[]
}

/**
 * Compare campaign counter columns vs send jobs, tracking events, and enrollments.
 * sent should equal terminal states + in-flight (PRD §6.7 / §14).
 */
export async function reconcileCampaignEvents(
  orgId: string,
  campaignId: string
): Promise<CampaignEventReconciliation> {
  const campaign = await pool.query<{
    sent_count: number
    open_count: number
    click_count: number
    reply_count: number
    bounce_count: number
  }>(
    `SELECT sent_count, open_count, click_count, reply_count, bounce_count
     FROM public.campaigns
     WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE`,
    [campaignId, orgId]
  )
  const reported = {
    sent: campaign.rows[0]?.sent_count ?? 0,
    opened: campaign.rows[0]?.open_count ?? 0,
    clicked: campaign.rows[0]?.click_count ?? 0,
    replied: campaign.rows[0]?.reply_count ?? 0,
    bounced: campaign.rows[0]?.bounce_count ?? 0,
  }

  const [jobs, enrollments, tracking] = await Promise.all([
    pool.query<{
      sent: number
      failed: number
      in_flight: number
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE status IN ('pending', 'processing', 'deferred'))::int AS in_flight
       FROM public.mail_send_jobs
       WHERE organization_id = $1 AND campaign_id = $2`,
      [orgId, campaignId]
    ),
    pool.query<{
      replied: number
      bounced: number
      active: number
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'replied')::int AS replied,
         COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active
       FROM public.mail_enrollments
       WHERE organization_id = $1 AND campaign_id = $2`,
      [orgId, campaignId]
    ),
    pool.query<{
      opens: number
      clicks: number
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM public.mail_tracking_pixel_events pe
          JOIN public.mail_tracking_tokens t ON t.id = pe.tracking_token_id
          WHERE t.organization_id = $1 AND t.campaign_id = $2) AS opens,
         (SELECT COUNT(*)::int FROM public.mail_tracking_click_events ce
          JOIN public.mail_tracking_tokens t ON t.id = ce.tracking_token_id
          WHERE t.organization_id = $1 AND t.campaign_id = $2) AS clicks`,
      [orgId, campaignId]
    ).catch(() => ({ rows: [{ opens: 0, clicks: 0 }] })),
  ])

  const jobSent = jobs.rows[0]?.sent ?? 0
  const inFlight = (jobs.rows[0]?.in_flight ?? 0) + (enrollments.rows[0]?.active ?? 0)
  const observed = {
    sent: jobSent,
    opened: tracking.rows[0]?.opens ?? reported.opened,
    clicked: tracking.rows[0]?.clicks ?? reported.clicked,
    replied: enrollments.rows[0]?.replied ?? 0,
    bounced: enrollments.rows[0]?.bounced ?? 0,
    inFlight,
  }

  const discrepancies: string[] = []
  if (reported.sent !== observed.sent + observed.inFlight) {
    discrepancies.push(
      `sent mismatch: reported=${reported.sent}, jobs=${observed.sent}, inFlight=${observed.inFlight}`
    )
  }
  if (reported.opened !== observed.opened) {
    discrepancies.push(`opened mismatch: reported=${reported.opened}, tracking=${observed.opened}`)
  }
  if (reported.clicked !== observed.clicked) {
    discrepancies.push(`clicked mismatch: reported=${reported.clicked}, tracking=${observed.clicked}`)
  }
  if (reported.replied !== observed.replied) {
    discrepancies.push(`replied mismatch: reported=${reported.replied}, enrollments=${observed.replied}`)
  }
  if (reported.bounced !== observed.bounced) {
    discrepancies.push(`bounced mismatch: reported=${reported.bounced}, enrollments=${observed.bounced}`)
  }

  return {
    campaignId,
    reported,
    observed,
    balanced: discrepancies.length === 0,
    discrepancies,
  }
}

export async function getOrgUsageSummary(orgId: string): Promise<{
  sends: number
  opens: number
  clicks: number
  replies: number
  bounces: number
  unsubscribes: number
  warmupSends: number
}> {
  const result = await pool.query<{
    sends: number
    opens: number
    clicks: number
    replies: number
    bounces: number
    unsubscribes: number
    warmup_sends: number
  }>(
    `SELECT
       COALESCE(SUM(sends), 0)::int AS sends,
       COALESCE(SUM(opens), 0)::int AS opens,
       COALESCE(SUM(clicks), 0)::int AS clicks,
       COALESCE(SUM(replies), 0)::int AS replies,
       COALESCE(SUM(bounces), 0)::int AS bounces,
       COALESCE(SUM(unsubscribes), 0)::int AS unsubscribes,
       COALESCE(SUM(warmup_sends), 0)::int AS warmup_sends
     FROM public.mail_mailbox_usage_daily
     WHERE organization_id = $1
       AND usage_date >= date_trunc('month', CURRENT_DATE)`,
    [orgId]
  )
  const row = result.rows[0]
  return {
    sends: row?.sends ?? 0,
    opens: row?.opens ?? 0,
    clicks: row?.clicks ?? 0,
    replies: row?.replies ?? 0,
    bounces: row?.bounces ?? 0,
    unsubscribes: row?.unsubscribes ?? 0,
    warmupSends: row?.warmup_sends ?? 0,
  }
}
