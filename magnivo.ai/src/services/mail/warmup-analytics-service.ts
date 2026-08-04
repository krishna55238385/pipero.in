import pool from '@/lib/db'
import * as warmupRepo from '@/repositories/mail/warmup-repository'

export type WarmupPlacementPoint = {
  date: string
  inbox: number
  spam: number
  unknown: number
  inboxRate: number
}

export type WarmupSimulationSnapshot = {
  partnersActive: number
  partnersExcluded: number
  spamRescues24h: number
  opens24h: number
  replies24h: number
  sends24h: number
  avgOpenRate24h: number
  contentVariantsLast24h: number
}

/** Inbox vs spam placement over time (PRD §6.3.15). */
export async function getWarmupPlacementSeries(
  orgId: string,
  days = 30
): Promise<WarmupPlacementPoint[]> {
  const result = await pool
    .query<{
      day: string
      inbox: string
      spam: string
      unknown: string
    }>(
      `SELECT DATE(created_at)::text AS day,
              COUNT(*) FILTER (WHERE placed_in = 'inbox')::text AS inbox,
              COUNT(*) FILTER (WHERE placed_in = 'spam')::text AS spam,
              COUNT(*) FILTER (WHERE placed_in = 'unknown')::text AS unknown
       FROM public.mail_warmup_pool_interactions
       WHERE organization_id = $1
         AND created_at >= NOW() - ($2 || ' days')::interval
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [orgId, String(days)]
    )
    .catch(() => ({ rows: [] as { day: string; inbox: string; spam: string; unknown: string }[] }))

  if (result.rows.length > 0) {
    return result.rows.map((r) => {
      const inbox = Number(r.inbox)
      const spam = Number(r.spam)
      const unknown = Number(r.unknown)
      const total = inbox + spam + unknown
      return {
        date: r.day,
        inbox,
        spam,
        unknown,
        inboxRate: total > 0 ? Math.round((inbox / total) * 1000) / 10 : 0,
      }
    })
  }

  // Fallback: derive from daily stats spam_reports vs successful_sends
  const configs = await warmupRepo.findConfigsByOrg(orgId)
  const byDay = new Map<string, { inbox: number; spam: number }>()
  for (const c of configs) {
    const stats = await warmupRepo.findStatsByConfigId(c.id).catch(() => [])
    for (const s of stats) {
      const key = s.date.slice(0, 10)
      const cur = byDay.get(key) || { inbox: 0, spam: 0 }
      cur.spam += s.spamReports || 0
      cur.inbox += Math.max(0, (s.successfulSends || 0) - (s.spamReports || 0))
      byDay.set(key, cur)
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => {
      const total = v.inbox + v.spam
      return {
        date,
        inbox: v.inbox,
        spam: v.spam,
        unknown: 0,
        inboxRate: total > 0 ? Math.round((v.inbox / total) * 1000) / 10 : 0,
      }
    })
}

/** Behavioral simulation fidelity monitor (PRD §6.3.36). */
export async function getWarmupSimulationSnapshot(orgId: string): Promise<WarmupSimulationSnapshot> {
  const [partners, interactions, variants] = await Promise.all([
    pool
      .query<{ active: string; excluded: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE health_status = 'healthy')::text AS active,
           COUNT(*) FILTER (WHERE health_status IN ('degraded','blacklisted','disabled'))::text AS excluded
         FROM public.mail_warmup_pool_mailboxes`
      )
      .catch(() => ({ rows: [{ active: '0', excluded: '0' }] })),
    pool
      .query<{
        sends: string
        opens: string
        replies: string
        rescues: string
      }>(
        `SELECT
           COUNT(*)::text AS sends,
           COUNT(*) FILTER (WHERE opened = true)::text AS opens,
           COUNT(*) FILTER (WHERE replied = true)::text AS replies,
           COUNT(*) FILTER (WHERE spam_rescued = true)::text AS rescues
         FROM public.mail_warmup_pool_interactions
         WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
        [orgId]
      )
      .catch(() => ({
        rows: [{ sends: '0', opens: '0', replies: '0', rescues: '0' }],
      })),
    pool
      .query<{ n: string }>(
        `SELECT COUNT(DISTINCT subject)::text AS n
         FROM public.mail_warmup_pool_interactions
         WHERE organization_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
        [orgId]
      )
      .catch(() => ({ rows: [{ n: '0' }] })),
  ])

  const sends = Number(interactions.rows[0]?.sends ?? 0)
  const opens = Number(interactions.rows[0]?.opens ?? 0)

  return {
    partnersActive: Number(partners.rows[0]?.active ?? 0),
    partnersExcluded: Number(partners.rows[0]?.excluded ?? 0),
    spamRescues24h: Number(interactions.rows[0]?.rescues ?? 0),
    opens24h: opens,
    replies24h: Number(interactions.rows[0]?.replies ?? 0),
    sends24h: sends,
    avgOpenRate24h: sends > 0 ? Math.round((opens / sends) * 1000) / 10 : 0,
    contentVariantsLast24h: Number(variants.rows[0]?.n ?? 0),
  }
}

export async function exportWarmupReportCsv(orgId: string): Promise<string> {
  const configs = await warmupRepo.findConfigsByOrg(orgId)
  const header = [
    'id',
    'mailbox_id',
    'mailbox_email',
    'status',
    'stage',
    'health',
    'prd_health',
    'current_day',
    'initial_sends',
    'max_daily',
    'spam_rescue',
    'created_at',
    'graduated_at',
  ]
  const rows = [header]

  const mailboxIds = configs.map((c) => c.mailboxId)
  const emails = new Map<string, string>()
  if (mailboxIds.length) {
    const r = await pool
      .query<{ id: string; email: string }>(
        `SELECT id, email FROM public.mail_mailboxes WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [orgId, mailboxIds]
      )
      .catch(() => ({ rows: [] as { id: string; email: string }[] }))
    for (const row of r.rows) emails.set(row.id, row.email)
  }

  for (const c of configs) {
    rows.push([
      c.id,
      c.mailboxId,
      emails.get(c.mailboxId) || '',
      c.status,
      c.stage,
      c.health,
      toPrdWarmupHealthLabel(c.health, c.stage),
      String(c.currentDay ?? ''),
      String(c.initialSends ?? ''),
      String(c.maxDailySends ?? ''),
      String(Boolean(c.spamRescue)),
      c.createdAt || '',
      c.graduatedAt || '',
    ])
  }
  return rows.map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}

/** Map internal health enums to PRD Cold/Warming/Warm labels (§6.3.11). */
export function toPrdWarmupHealthLabel(health: string, stage?: string): 'Cold' | 'Warming' | 'Warm' {
  const h = (health || '').toLowerCase()
  const s = (stage || '').toLowerCase()
  if (s === 'graduated' || h === 'excellent') return 'Warm'
  if (h === 'critical' || s === 'initial') return 'Cold'
  return 'Warming'
}
