import pool from '@/lib/db'

export type EngageOverviewSnapshot = {
  mailboxes: { total: number; connected: number; reconnectRequired: number; warming: number }
  campaigns: { total: number; running: number; paused: number }
  warmup: { running: number; graduated: number; avgHealth: number }
  leads: { total: number; valid: number; suppressed: number }
  deliverability: { domains: number; healthy: number; listed: number }
  sending: { pendingJobs: number; failedJobs: number; sentToday: number }
  inbox: { unreadThreads: number; needsReview: number }
}

export async function getEngageOverviewSnapshot(orgId: string): Promise<EngageOverviewSnapshot> {
  const empty: EngageOverviewSnapshot = {
    mailboxes: { total: 0, connected: 0, reconnectRequired: 0, warming: 0 },
    campaigns: { total: 0, running: 0, paused: 0 },
    warmup: { running: 0, graduated: 0, avgHealth: 0 },
    leads: { total: 0, valid: 0, suppressed: 0 },
    deliverability: { domains: 0, healthy: 0, listed: 0 },
    sending: { pendingJobs: 0, failedJobs: 0, sentToday: 0 },
    inbox: { unreadThreads: 0, needsReview: 0 },
  }

  try {
    const [mb, camp, warm, leads, domains, jobs, inbox] = await Promise.all([
      pool.query<{ total: number; connected: number; reconnect_required: number; warming: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE mailbox_status = 'connected')::int AS connected,
           COUNT(*) FILTER (WHERE mailbox_status IN ('reconnect_required','oauth_expired','error'))::int AS reconnect_required,
           COUNT(*) FILTER (WHERE mailbox_status = 'warming' OR warmup_status IN ('warming','active'))::int AS warming
         FROM public.mail_mailboxes
         WHERE organization_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE`,
        [orgId]
      ).catch(() => ({ rows: [empty.mailboxes as never] })),
      pool.query<{ total: number; running: number; paused: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE status = 'running')::int AS running,
           COUNT(*) FILTER (WHERE status = 'paused')::int AS paused
         FROM public.campaigns
         WHERE organization_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE`,
        [orgId]
      ).catch(() => ({ rows: [{ total: 0, running: 0, paused: 0 }] })),
      pool.query<{ running: number; graduated: number; avg_health: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'running')::int AS running,
           COUNT(*) FILTER (WHERE status = 'graduated')::int AS graduated,
           COALESCE(AVG(CASE WHEN status = 'running' THEN graduation_threshold ELSE NULL END), 0)::float AS avg_health
         FROM public.mail_warmup_configs
         WHERE organization_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [{ running: 0, graduated: 0, avg_health: 0 }] })),
      pool.query<{ total: number; valid: number; suppressed: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE verified_status = 'valid')::int AS valid,
           COUNT(*) FILTER (WHERE suppressed = TRUE)::int AS suppressed
         FROM public.mail_leads WHERE organization_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [{ total: 0, valid: 0, suppressed: 0 }] })),
      pool.query<{ domains: number; healthy: number }>(
        `SELECT
           COUNT(*)::int AS domains,
           COUNT(*) FILTER (WHERE health_status IN ('excellent','good'))::int AS healthy
         FROM public.mail_deliverability_domains WHERE organization_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [{ domains: 0, healthy: 0 }] })),
      pool.query<{ pending: number; failed: number; sent_today: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('pending','deferred','processing'))::int AS pending,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
           COUNT(*) FILTER (WHERE status = 'sent' AND sent_at::date = CURRENT_DATE)::int AS sent_today
         FROM public.mail_send_jobs WHERE organization_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [{ pending: 0, failed: 0, sent_today: 0 }] })),
      pool.query<{ unread: number; needs_review: number }>(
        `SELECT
           COALESCE(SUM(unread_count), 0)::int AS unread,
           COUNT(*) FILTER (WHERE classification = 'needs_human_review')::int AS needs_review
         FROM public.mail_inbox_threads WHERE organization_id = $1`,
        [orgId]
      ).catch(() => ({ rows: [{ unread: 0, needs_review: 0 }] })),
    ])

    const listed = await pool
      .query<{ c: number }>(
        `SELECT COUNT(DISTINCT domain_id)::int AS c
         FROM public.mail_blacklist_checks
         WHERE organization_id = $1 AND status = 'listed'`,
        [orgId]
      )
      .catch(() => ({ rows: [{ c: 0 }] }))

    const m = mb.rows[0] || { total: 0, connected: 0, reconnect_required: 0, warming: 0 }
    const c = camp.rows[0] || { total: 0, running: 0, paused: 0 }
    const w = warm.rows[0] || { running: 0, graduated: 0, avg_health: 0 }
    const l = leads.rows[0] || { total: 0, valid: 0, suppressed: 0 }
    const d = domains.rows[0] || { domains: 0, healthy: 0 }
    const j = jobs.rows[0] || { pending: 0, failed: 0, sent_today: 0 }
    const i = inbox.rows[0] || { unread: 0, needs_review: 0 }

    return {
      mailboxes: {
        total: m.total,
        connected: m.connected,
        reconnectRequired: m.reconnect_required,
        warming: m.warming,
      },
      campaigns: { total: c.total, running: c.running, paused: c.paused },
      warmup: { running: w.running, graduated: w.graduated, avgHealth: Math.round(Number(w.avg_health) || 0) },
      leads: { total: l.total, valid: l.valid, suppressed: l.suppressed },
      deliverability: { domains: d.domains, healthy: d.healthy, listed: listed.rows[0]?.c || 0 },
      sending: { pendingJobs: j.pending, failedJobs: j.failed, sentToday: j.sent_today },
      inbox: { unreadThreads: i.unread, needsReview: i.needs_review },
    }
  } catch {
    return empty
  }
}

export type ReportExportRow = Record<string, string | number>

export async function buildCampaignPerformanceReport(orgId: string): Promise<ReportExportRow[]> {
  const result = await pool.query(
    `SELECT name, status, recipient_count, sent_count, open_count, click_count, reply_count, bounce_count, unsubscribe_count, updated_at
     FROM public.campaigns
     WHERE organization_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
     ORDER BY updated_at DESC
     LIMIT 500`,
    [orgId]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return result.rows.map((r) => ({
    name: String(r.name || ''),
    status: String(r.status || ''),
    recipients: Number(r.recipient_count || 0),
    sent: Number(r.sent_count || 0),
    opened: Number(r.open_count || 0),
    clicked: Number(r.click_count || 0),
    replied: Number(r.reply_count || 0),
    bounced: Number(r.bounce_count || 0),
    unsubscribed: Number(r.unsubscribe_count || 0),
    updatedAt: String(r.updated_at || ''),
  }))
}

export async function buildMailboxHealthReport(orgId: string): Promise<ReportExportRow[]> {
  const result = await pool.query(
    `SELECT email, provider, mailbox_status, health_score, health_status, daily_limit, current_daily_usage, warmup_status, updated_at
     FROM public.mail_mailboxes
     WHERE organization_id = $1 AND COALESCE(is_deleted, FALSE) = FALSE
     ORDER BY health_score ASC NULLS LAST
     LIMIT 500`,
    [orgId]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return result.rows.map((r) => ({
    email: String(r.email || ''),
    provider: String(r.provider || ''),
    status: String(r.mailbox_status || ''),
    healthScore: Number(r.health_score || 0),
    healthStatus: String(r.health_status || ''),
    dailyLimit: Number(r.daily_limit || 0),
    dailyUsage: Number(r.current_daily_usage || 0),
    warmupStatus: String(r.warmup_status || ''),
    updatedAt: String(r.updated_at || ''),
  }))
}

export async function buildLeadHygieneReport(orgId: string): Promise<ReportExportRow[]> {
  const result = await pool.query(
    `SELECT email, name, company, verified_status, suppressed, status, source, updated_at
     FROM public.mail_leads
     WHERE organization_id = $1
     ORDER BY updated_at DESC
     LIMIT 2000`,
    [orgId]
  ).catch(() => ({ rows: [] as Record<string, unknown>[] }))

  return result.rows.map((r) => ({
    email: String(r.email || ''),
    name: String(r.name || ''),
    company: String(r.company || ''),
    verifiedStatus: String(r.verified_status || ''),
    suppressed: r.suppressed ? 'yes' : 'no',
    status: String(r.status || ''),
    source: String(r.source || ''),
    updatedAt: String(r.updated_at || ''),
  }))
}

export function rowsToCsv(rows: ReportExportRow[]): string {
  if (rows.length === 0) return ''
  const headers = Object.keys(rows[0])
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(
      headers
        .map((h) => {
          const v = String(row[h] ?? '')
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
        })
        .join(',')
    )
  }
  return lines.join('\n')
}
