import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import pool from '@/lib/db'

const log = createLogger('metrics')

export async function GET(req: NextRequest) {
  try {
    const [
      sendQueue,
      mailboxes,
      mailboxesByStatus,
      activeCampaigns,
      trackingOpens,
      trackingClicks,
      schedulerState,
      warmupJobs,
    ] = await Promise.all([
      getSendQueueCounts(),
      getMailboxCount(),
      getMailboxesByStatus(),
      getActiveCampaigns(),
      getTrackingOpenCount(),
      getTrackingClickCount(),
      getSchedulerState(),
      getWarmupJobCounts(),
    ])

    const lines: string[] = ['# HELP magnivo_send_queue_pending Pending send jobs', '# TYPE magnivo_send_queue_pending gauge']
    lines.push(`magnivo_send_queue_pending ${sendQueue.pending}`)

    lines.push('# HELP magnivo_send_queue_deferred Deferred send jobs', '# TYPE magnivo_send_queue_deferred gauge')
    lines.push(`magnivo_send_queue_deferred ${sendQueue.deferred}`)

    lines.push('# HELP magnivo_send_queue_failed Failed send jobs', '# TYPE magnivo_send_queue_failed gauge')
    lines.push(`magnivo_send_queue_failed ${sendQueue.failed}`)

    lines.push('# HELP magnivo_send_queue_dead_letter Dead-letter send jobs', '# TYPE magnivo_send_queue_dead_letter gauge')
    lines.push(`magnivo_send_queue_dead_letter ${sendQueue.deadLetter}`)

    lines.push('# HELP magnivo_send_queue_sent_total Total sent jobs', '# TYPE magnivo_send_queue_sent_total counter')
    lines.push(`magnivo_send_queue_sent_total ${sendQueue.sent}`)

    lines.push('# HELP magnivo_mailboxes_total Total mailboxes', '# TYPE magnivo_mailboxes_total gauge')
    lines.push(`magnivo_mailboxes_total ${mailboxes}`)

    lines.push('# HELP magnivo_mailboxes_by_status Mailboxes grouped by status', '# TYPE magnivo_mailboxes_by_status gauge')
    for (const [status, count] of Object.entries(mailboxesByStatus)) {
      lines.push(`magnivo_mailboxes_by_status{status="${status}"} ${count}`)
    }

    lines.push('# HELP magnivo_campaigns_active Active campaigns', '# TYPE magnivo_campaigns_active gauge')
    lines.push(`magnivo_campaigns_active ${activeCampaigns}`)

    lines.push('# HELP magnivo_tracking_opens_total Total pixel open events', '# TYPE magnivo_tracking_opens_total counter')
    lines.push(`magnivo_tracking_opens_total ${trackingOpens}`)

    lines.push('# HELP magnivo_tracking_clicks_total Total click events', '# TYPE magnivo_tracking_clicks_total counter')
    lines.push(`magnivo_tracking_clicks_total ${trackingClicks}`)

    lines.push('# HELP magnivo_warmup_scheduler_heartbeat Last warmup scheduler heartbeat (epoch seconds)', '# TYPE magnivo_warmup_scheduler_heartbeat gauge')
    lines.push(`magnivo_warmup_scheduler_heartbeat ${schedulerState.heartbeatEpoch}`)

    lines.push('# HELP magnivo_warmup_jobs_pending Pending warmup jobs', '# TYPE magnivo_warmup_jobs_pending gauge')
    lines.push(`magnivo_warmup_jobs_pending ${warmupJobs.pending}`)

    lines.push('# HELP magnivo_warmup_jobs_failed Failed warmup jobs', '# TYPE magnivo_warmup_jobs_failed gauge')
    lines.push(`magnivo_warmup_jobs_failed ${warmupJobs.failed}`)

    lines.push('# EOF')

    return new NextResponse(lines.join('\n') + '\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'metrics_failed'
    log.error('Metrics generation failed', { error: message })
    return new NextResponse(`# ERROR metrics generation failed\n`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}

async function getSendQueueCounts(): Promise<Record<string, number>> {
  const result = await pool.query<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count
     FROM public.mail_send_jobs
     GROUP BY status`
  )
  const counts: Record<string, number> = { pending: 0, deferred: 0, failed: 0, sent: 0, deadLetter: 0 }
  for (const row of result.rows) {
    if (row.status in counts) {
      counts[row.status] = row.count
    }
  }
  const dlq = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs_dlq WHERE replayed_at IS NULL`
  )
  counts.deadLetter = dlq.rows[0]?.count ?? 0
  return counts
}

async function getMailboxCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.mail_mailboxes WHERE deleted_at IS NULL`
  )
  return result.rows[0]?.count ?? 0
}

async function getMailboxesByStatus(): Promise<Record<string, number>> {
  const result = await pool.query<{ status: string; count: number }>(
    `SELECT mailbox_status AS status, COUNT(*)::int AS count
     FROM public.mail_mailboxes
     WHERE deleted_at IS NULL
     GROUP BY mailbox_status`
  )
  const map: Record<string, number> = {}
  for (const row of result.rows) {
    map[row.status] = row.count
  }
  return map
}

async function getActiveCampaigns(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.campaigns
     WHERE status = 'running' AND is_deleted = FALSE`
  )
  return result.rows[0]?.count ?? 0
}

async function getTrackingOpenCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.mail_tracking_pixel_events`
  )
  return result.rows[0]?.count ?? 0
}

async function getTrackingClickCount(): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM public.mail_click_events`
  )
  return result.rows[0]?.count ?? 0
}

async function getSchedulerState(): Promise<{ heartbeatEpoch: number }> {
  const result = await pool.query<{ last_heartbeat: string | null }>(
    `SELECT last_heartbeat FROM public.warmup_scheduler_state WHERE id = 'singleton'`
  )
  const row = result.rows[0]
  if (row?.last_heartbeat) {
    return { heartbeatEpoch: Math.floor(new Date(row.last_heartbeat).getTime() / 1000) }
  }
  return { heartbeatEpoch: 0 }
}

async function getWarmupJobCounts(): Promise<Record<string, number>> {
  const result = await pool.query<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count
     FROM public.warmup_jobs
     GROUP BY status`
  )
  const counts: Record<string, number> = { pending: 0, failed: 0 }
  for (const row of result.rows) {
    if (row.status === 'pending' || row.status === 'queued') {
      counts.pending += row.count
    } else if (row.status === 'failed') {
      counts.failed += row.count
    }
  }
  return counts
}
