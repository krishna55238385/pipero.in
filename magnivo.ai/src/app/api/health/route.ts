import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import pool from '@/lib/db'

const log = createLogger('health')

type CheckResult = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  message?: string
  [key: string]: unknown
}

export async function GET(req: NextRequest) {
  const checks: Record<string, CheckResult> = {}

  checks.db = await checkDb()

  if (checks.db.status === 'healthy') {
    const [queue, workers, oauth] = await Promise.all([
      checkQueueHealth(),
      checkWorkerHeartbeats(),
      checkOAuthProbe(),
    ])
    checks.queue = queue
    checks.workers = workers
    checks.oauth = oauth
  } else {
    checks.queue = { status: 'unhealthy', message: 'Skipped — DB unavailable' }
    checks.workers = { status: 'unhealthy', message: 'Skipped — DB unavailable' }
    checks.oauth = { status: 'unhealthy', message: 'Skipped — DB unavailable' }
  }

  const statuses = Object.values(checks).map(c => c.status)
  let overall: 'healthy' | 'degraded' | 'unhealthy'
  if (statuses.every(s => s === 'healthy')) {
    overall = 'healthy'
  } else if (statuses.some(s => s === 'unhealthy')) {
    overall = 'unhealthy'
  } else {
    overall = 'degraded'
  }

  log.info('Health check complete', { overall, checks: Object.keys(checks) })

  return NextResponse.json({
    status: overall,
    checks,
    timestamp: new Date().toISOString(),
  })
}

async function checkDb(): Promise<CheckResult> {
  try {
    const start = Date.now()
    await pool.query('SELECT 1')
    const duration = Date.now() - start
    return { status: 'healthy', latencyMs: duration }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'db_unreachable'
    log.error('Health — DB check failed', { error: message })
    return { status: 'unhealthy', message }
  }
}

async function checkQueueHealth(): Promise<CheckResult> {
  try {
    const result = await pool.query<{
      status: string
      count: number
    }>(
      `SELECT status, COUNT(*)::int AS count
       FROM public.mail_send_jobs
       GROUP BY status`
    )
    const counts: Record<string, number> = {}
    for (const row of result.rows) {
      counts[row.status] = row.count
    }
    const dlqResult = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs_dlq WHERE replayed_at IS NULL`
    )
    const dlqCount = dlqResult.rows[0]?.count ?? 0
    const failedCount = counts['failed'] ?? 0
    const deferredCount = counts['deferred'] ?? 0

    const degraded = failedCount > 100 || deferredCount > 500 || dlqCount > 50
    const unhealthy = failedCount > 1000 || dlqCount > 200

    return {
      status: unhealthy ? 'unhealthy' : degraded ? 'degraded' : 'healthy',
      pending: counts['pending'] ?? 0,
      processing: counts['processing'] ?? 0,
      deferred: deferredCount,
      failed: failedCount,
      sent: counts['sent'] ?? 0,
      deadLetter: dlqCount,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'queue_check_failed'
    log.error('Health — queue check failed', { error: message })
    return { status: 'unhealthy', message }
  }
}

async function checkWorkerHeartbeats(): Promise<CheckResult> {
  try {
    const result = await pool.query<{
      status: string
      last_heartbeat: string | null
      last_run_at: string | null
      errors_count: number
    }>(
      `SELECT status, last_heartbeat, last_run_at, errors_count
       FROM public.warmup_scheduler_state
       WHERE id = 'singleton'`
    )
    const row = result.rows[0]
    if (!row) {
      return { status: 'degraded', message: 'No scheduler state record' }
    }

    const now = Date.now()
    const heartbeatAge = row.last_heartbeat
      ? now - new Date(row.last_heartbeat).getTime()
      : Infinity
    const runAge = row.last_run_at
      ? now - new Date(row.last_run_at).getTime()
      : Infinity

    const isRunning = row.status === 'running'
    const recentHeartbeat = heartbeatAge < 300_000
    const recentRun = runAge < 600_000

    let status: 'healthy' | 'degraded' | 'unhealthy'
    if (isRunning && recentHeartbeat && recentRun) {
      status = 'healthy'
    } else if (!isRunning || heartbeatAge > 900_000) {
      status = 'unhealthy'
    } else {
      status = 'degraded'
    }

    return {
      status,
      schedulerStatus: row.status,
      lastHeartbeat: row.last_heartbeat,
      lastRunAt: row.last_run_at,
      errorsCount: row.errors_count,
      heartbeatAgeMs: heartbeatAge === Infinity ? null : heartbeatAge,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'worker_check_failed'
    log.error('Health — worker check failed', { error: message })
    return { status: 'unhealthy', message }
  }
}

async function checkOAuthProbe(): Promise<CheckResult> {
  try {
    const { runOAuthHealthProbeJob } = await import('@/services/mail/oauth-health-probe')
    const result = await runOAuthHealthProbeJob()
    const hasRevoked = result.revoked > 0
    return {
      status: hasRevoked ? 'degraded' : 'healthy',
      checked: result.checked,
      healthy: result.healthy,
      revoked: result.revoked,
      skipped: result.skipped,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'oauth_probe_failed'
    log.error('Health — OAuth probe failed', { error: message })
    return { status: 'degraded', message }
  }
}
