import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import pool from '@/lib/db'

const log = createLogger('worker-health')

type WorkerDetail = {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'
  message?: string
  [key: string]: unknown
}

type CheckResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  workers: {
    send: WorkerDetail
    warmup: WorkerDetail
    deliverability: WorkerDetail
    inboxPoller: WorkerDetail
    webhookDelivery: WorkerDetail
  }
  timestamp: string
}

export async function GET(req: NextRequest) {
  const result: CheckResult = {
    status: 'healthy',
    workers: {
      send: { status: 'unknown' },
      warmup: { status: 'unknown' },
      deliverability: { status: 'unknown' },
      inboxPoller: { status: 'unknown' },
      webhookDelivery: { status: 'unknown' },
    },
    timestamp: new Date().toISOString(),
  }

  await Promise.all([
    checkSendWorker(result),
    checkWarmupWorker(result),
    checkDeliverabilityWorker(result),
    checkInboxPoller(result),
    checkWebhookDelivery(result),
  ])

  const statuses = Object.values(result.workers).map(w => w.status)
  if (statuses.every(s => s === 'healthy')) {
    result.status = 'healthy'
  } else if (statuses.some(s => s === 'unhealthy')) {
    result.status = 'unhealthy'
  } else {
    result.status = 'degraded'
  }

  log.info('Worker health check complete', { status: result.status })

  return NextResponse.json(result)
}

async function checkSendWorker(result: CheckResult): Promise<void> {
  try {
    const counts = await pool.query<{ status: string; count: number }>(
      `SELECT status, COUNT(*)::int AS count
       FROM public.mail_send_jobs
       GROUP BY status`
    )
    const map: Record<string, number> = {}
    for (const row of counts.rows) {
      map[row.status] = row.count
    }
    const dlq = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs_dlq WHERE replayed_at IS NULL`
    )
    const deadLetter = dlq.rows[0]?.count ?? 0
    const failed = map['failed'] ?? 0

    result.workers.send = {
      status: failed > 1000 || deadLetter > 200 ? 'unhealthy' : failed > 100 || deadLetter > 50 ? 'degraded' : 'healthy',
      pending: map['pending'] ?? 0,
      processing: map['processing'] ?? 0,
      deferred: map['deferred'] ?? 0,
      failed,
      sent: map['sent'] ?? 0,
      deadLetter,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'send_worker_check_failed'
    log.error('Send worker check failed', { error: message })
    result.workers.send = { status: 'unhealthy', error: message }
  }
}

async function checkWarmupWorker(result: CheckResult): Promise<void> {
  try {
    const state = await pool.query<{
      status: string
      last_heartbeat: string | null
      last_run_at: string | null
      errors_count: number
      configs_processed: number
      jobs_created: number
    }>(
      `SELECT status, last_heartbeat, last_run_at, errors_count,
              configs_processed, jobs_created
       FROM public.warmup_scheduler_state
       WHERE id = 'singleton'`
    )
    const row = state.rows[0]
    if (!row) {
      result.workers.warmup = { status: 'unknown', message: 'No scheduler state record' }
      return
    }

    const now = Date.now()
    const heartbeatAge = row.last_heartbeat
      ? now - new Date(row.last_heartbeat).getTime()
      : Infinity
    const isRunning = row.status === 'running'
    const recentHeartbeat = heartbeatAge < 300_000

    let status: 'healthy' | 'degraded' | 'unhealthy'
    if (isRunning && recentHeartbeat) {
      status = 'healthy'
    } else if (!isRunning) {
      status = 'unhealthy'
    } else {
      status = 'degraded'
    }

    result.workers.warmup = {
      status,
      schedulerStatus: row.status,
      lastHeartbeat: row.last_heartbeat,
      lastRunAt: row.last_run_at,
      errorsCount: row.errors_count,
      configsProcessed: row.configs_processed,
      jobsCreated: row.jobs_created,
      heartbeatAgeMs: heartbeatAge === Infinity ? null : heartbeatAge,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'warmup_worker_check_failed'
    log.error('Warmup worker check failed', { error: message })
    result.workers.warmup = { status: 'unhealthy', error: message }
  }
}

async function checkDeliverabilityWorker(result: CheckResult): Promise<void> {
  try {
    const mailboxes = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_mailboxes
       WHERE deleted_at IS NULL AND mailbox_status = 'error'`
    )
    const bounces = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_bounce_records
       WHERE created_at > NOW() - INTERVAL '24 hours'`
    )
    const complaints = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_complaint_records
       WHERE created_at > NOW() - INTERVAL '24 hours'`
    )
    result.workers.deliverability = {
      status: mailboxes.rows[0]?.count > 10 ? 'degraded' : 'healthy',
      mailboxesInError: mailboxes.rows[0]?.count ?? 0,
      bouncesLast24h: bounces.rows[0]?.count ?? 0,
      complaintsLast24h: complaints.rows[0]?.count ?? 0,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'deliverability_worker_check_failed'
    log.error('Deliverability worker check failed', { error: message })
    result.workers.deliverability = { status: 'unhealthy', error: message }
  }
}

async function checkInboxPoller(result: CheckResult): Promise<void> {
  try {
    const mailboxCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_mailboxes
       WHERE deleted_at IS NULL AND mailbox_status = 'connected'`
    )
    const threadCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_inbox_threads`
    )
    result.workers.inboxPoller = {
      status: 'healthy',
      connectedMailboxes: mailboxCount.rows[0]?.count ?? 0,
      totalThreads: threadCount.rows[0]?.count ?? 0,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'inbox_poller_check_failed'
    log.error('Inbox poller check failed', { error: message })
    result.workers.inboxPoller = { status: 'unhealthy', error: message }
  }
}

async function checkWebhookDelivery(result: CheckResult): Promise<void> {
  try {
    const pending = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_webhook_deliveries
       WHERE status IN ('pending', 'retrying')`
    ).catch(() => ({ rows: [{ count: 0 }] }))
    result.workers.webhookDelivery = {
      status: 'healthy',
      pendingDeliveries: pending.rows[0]?.count ?? 0,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'webhook_delivery_check_failed'
    log.error('Webhook delivery check failed', { error: message })
    result.workers.webhookDelivery = { status: 'unhealthy', error: message }
  }
}
