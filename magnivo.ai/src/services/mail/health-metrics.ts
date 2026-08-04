import pool from '@/lib/db'

export type HealthStatus = {
  status: 'healthy' | 'degraded' | 'unhealthy'
  database: 'connected' | 'disconnected'
  queue?: {
    pending: number
    processing: number
    failed: number
    deadLetter: number
  }
  uptime: number
  version: string
  timestamp: string
}

export type WorkerHealth = {
  workerId: string
  workerType: string
  status: string
  lastHeartbeat: string
  jobsProcessed: number
  uptimeSeconds: number
}

const START_TIME = Date.now()

export async function getHealthStatus(): Promise<HealthStatus> {
  try {
    await pool.query('SELECT 1')
  } catch {
    return {
      status: 'unhealthy',
      database: 'disconnected',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: process.env.APP_VERSION || '1.0.0',
      timestamp: new Date().toISOString(),
    }
  }

  let queueFailureCount = 0
  try {
    const failedResult = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM public.mail_send_jobs
       WHERE status IN ('failed', 'dead_letter')
       GROUP BY status`
    )
    for (const row of failedResult.rows) {
      queueFailureCount += row.count
    }
  } catch {
    // queue stats unavailable, degraded but not unhealthy
  }

  const status: HealthStatus = {
    status: queueFailureCount > 0 ? 'degraded' : 'healthy',
    database: 'connected',
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    version: process.env.APP_VERSION || '1.0.0',
    timestamp: new Date().toISOString(),
  }

  return status
}

export async function getMetrics(): Promise<string> {
  const lines: string[] = []

  const pendingResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs WHERE status = 'pending'`
  )
  lines.push('# HELP magnivo_queue_pending_jobs Number of pending send jobs')
  lines.push('# TYPE magnivo_queue_pending_jobs gauge')
  lines.push(`magnivo_queue_pending_jobs ${pendingResult.rows[0].count}`)

  const processingResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs WHERE status = 'processing'`
  )
  lines.push('# HELP magnivo_queue_processing_jobs Number of processing send jobs')
  lines.push('# TYPE magnivo_queue_processing_jobs gauge')
  lines.push(`magnivo_queue_processing_jobs ${processingResult.rows[0].count}`)

  const failedResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs WHERE status = 'failed'`
  )
  lines.push('# HELP magnivo_queue_failed_jobs Number of failed send jobs')
  lines.push('# TYPE magnivo_queue_failed_jobs gauge')
  lines.push(`magnivo_queue_failed_jobs ${failedResult.rows[0].count}`)

  const sentResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs WHERE status = 'sent'`
  )
  lines.push('# HELP magnivo_queue_sent_jobs_total Total sent jobs')
  lines.push('# TYPE magnivo_queue_sent_jobs_total counter')
  lines.push(`magnivo_queue_sent_jobs_total ${sentResult.rows[0].count}`)

  const dlqResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_send_jobs_dlq`
  )
  lines.push('# HELP magnivo_dead_letter_jobs_total Total dead-letter jobs')
  lines.push('# TYPE magnivo_dead_letter_jobs_total counter')
  lines.push(`magnivo_dead_letter_jobs_total ${dlqResult.rows[0].count}`)

  lines.push('# HELP magnivo_uptime_seconds Application uptime in seconds')
  lines.push('# TYPE magnivo_uptime_seconds gauge')
  lines.push(`magnivo_uptime_seconds ${Math.floor((Date.now() - START_TIME) / 1000)}`)

  lines.push('# HELP magnivo_workers_active Number of active workers')
  lines.push('# TYPE magnivo_workers_active gauge')
  try {
    const workersResult = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.mail_workers WHERE status = 'active'`
    )
    lines.push(`magnivo_workers_active ${workersResult.rows[0].count}`)
  } catch {
    lines.push('magnivo_workers_active 0')
  }

  return lines.join('\n') + '\n'
}

export async function getWorkerHealth(): Promise<WorkerHealth[]> {
  try {
    const result = await pool.query(
      `SELECT worker_id, worker_type, status, last_heartbeat, jobs_processed, uptime_seconds
       FROM public.mail_workers
       ORDER BY worker_type, worker_id`
    )
    const staleThreshold = Date.now() - 5 * 60 * 1000
    return result.rows.map((row) => ({
      workerId: row.worker_id,
      workerType: row.worker_type,
      status: new Date(row.last_heartbeat).getTime() < staleThreshold ? 'stale' : row.status,
      lastHeartbeat: row.last_heartbeat,
      jobsProcessed: row.jobs_processed,
      uptimeSeconds: row.uptime_seconds,
    }))
  } catch {
    return []
  }
}
