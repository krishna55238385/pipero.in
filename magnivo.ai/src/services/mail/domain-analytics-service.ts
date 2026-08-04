import pool from '@/lib/db'
import * as reputationService from './reputation-service'
import * as domainRepo from '@/repositories/mail/domain-repository'
import type { ReputationTrend } from '@/types/deliverability'

export type DomainAnalyticsSnapshot = {
  domainId: string
  domain: string
  healthScore: number | null
  spfStatus: string
  dkimStatus: string
  dmarcStatus: string
  mxStatus: string
  trackingStatus: string
  mailboxCount: number
  sent7d: number
  bounced7d: number
  opened7d: number
  replied7d: number
  bounceRate7d: number
  openRate7d: number
  replyRate7d: number
  reputationTrend: ReputationTrend[]
  currentReputation: number | null
}

/**
 * Domain-level analytics (PRD §6.2.34 / §6.2.35 depth).
 */
export async function getDomainAnalytics(
  orgId: string,
  domainId: string
): Promise<DomainAnalyticsSnapshot | null> {
  const domain = await domainRepo.findDomainById(domainId, orgId)
  if (!domain) return null

  const domainName = domain.domain.toLowerCase()

  const [mailboxes, volume, trend] = await Promise.all([
    pool
      .query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM public.mail_mailboxes
         WHERE organization_id = $1
           AND deleted_at IS NULL
           AND LOWER(SPLIT_PART(email, '@', 2)) = $2`,
        [orgId, domainName]
      )
      .catch(() => ({ rows: [{ count: '0' }] })),
    pool
      .query<{
        sent: string
        bounced: string
        opened: string
        replied: string
      }>(
        `SELECT
           COUNT(*) FILTER (WHERE j.status IN ('sent','delivered','opened','clicked','replied'))::text AS sent,
           COUNT(*) FILTER (WHERE j.status IN ('bounced','hard_bounce','soft_bounce','failed'))::text AS bounced,
           COUNT(*) FILTER (WHERE j.status IN ('opened','clicked','replied'))::text AS opened,
           COUNT(*) FILTER (WHERE j.status = 'replied')::text AS replied
         FROM public.mail_send_jobs j
         INNER JOIN public.mail_mailboxes m ON m.id = j.mailbox_id
         WHERE j.organization_id = $1
           AND j.created_at >= NOW() - INTERVAL '7 days'
           AND LOWER(SPLIT_PART(m.email, '@', 2)) = $2`,
        [orgId, domainName]
      )
      .catch(() => ({
        rows: [{ sent: '0', bounced: '0', opened: '0', replied: '0' }],
      })),
    reputationService.getDomainReputationTrend(domainId).catch(() => [] as ReputationTrend[]),
  ])

  const sent = Number(volume.rows[0]?.sent ?? 0)
  const bounced = Number(volume.rows[0]?.bounced ?? 0)
  const opened = Number(volume.rows[0]?.opened ?? 0)
  const replied = Number(volume.rows[0]?.replied ?? 0)

  return {
    domainId: domain.id,
    domain: domain.domain,
    healthScore: domain.healthScore ?? null,
    spfStatus: domain.spfStatus,
    dkimStatus: domain.dkimStatus,
    dmarcStatus: domain.dmarcStatus,
    mxStatus: domain.mxStatus,
    trackingStatus: domain.trackingStatus,
    mailboxCount: Number(mailboxes.rows[0]?.count ?? 0),
    sent7d: sent,
    bounced7d: bounced,
    opened7d: opened,
    replied7d: replied,
    bounceRate7d: sent > 0 ? Math.round((bounced / sent) * 1000) / 10 : 0,
    openRate7d: sent > 0 ? Math.round((opened / sent) * 1000) / 10 : 0,
    replyRate7d: sent > 0 ? Math.round((replied / sent) * 1000) / 10 : 0,
    reputationTrend: trend,
    currentReputation: trend.length ? trend[trend.length - 1].score : null,
  }
}

export async function exportDomainAnalyticsCsv(orgId: string): Promise<string> {
  const domains = await domainRepo.findDomainsByOrg(orgId)
  const rows = [['domain', 'health', 'mailboxes', 'sent_7d', 'bounce_rate_7d', 'open_rate_7d', 'reply_rate_7d', 'reputation']]
  for (const d of domains) {
    const snap = await getDomainAnalytics(orgId, d.id)
    if (!snap) continue
    rows.push([
      snap.domain,
      String(snap.healthScore ?? ''),
      String(snap.mailboxCount),
      String(snap.sent7d),
      String(snap.bounceRate7d),
      String(snap.openRate7d),
      String(snap.replyRate7d),
      String(snap.currentReputation ?? ''),
    ])
  }
  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
}
