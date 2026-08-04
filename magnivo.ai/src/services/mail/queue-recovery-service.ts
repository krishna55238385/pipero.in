import pool from '@/lib/db'
import { createLogger } from '@/lib/logger'

const log = createLogger('queue-recovery')

export async function recoverStuckProcessingJobs(timeoutMinutes = 30): Promise<{ recovered: number }> {
  const result = await pool.query(
    `UPDATE public.mail_send_jobs
     SET status = 'pending', next_attempt_at = NOW(), updated_at = NOW()
     WHERE status = 'processing' AND updated_at <= NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [String(timeoutMinutes)]
  )
  const recovered = result.rowCount ?? 0
  if (recovered > 0) {
    log.info('Recovered stuck processing jobs', { count: recovered, timeoutMinutes })
  }
  return { recovered }
}

export async function recoverStuckWarmupJobs(timeoutMinutes = 30): Promise<{ recovered: number }> {
  const result = await pool.query(
    `UPDATE public.mail_warmup_jobs
     SET status = 'pending', updated_at = NOW()
     WHERE status = 'running' AND updated_at <= NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [String(timeoutMinutes)]
  )
  const recovered = result.rowCount ?? 0
  if (recovered > 0) {
    log.info('Recovered stuck warmup jobs', { count: recovered, timeoutMinutes })
  }
  return { recovered }
}

export async function cancelStalePendingJobs(olderThanHours = 24): Promise<{ cancelled: number }> {
  const result = await pool.query(
    `UPDATE public.mail_send_jobs
     SET status = 'cancelled', last_error = 'stale', updated_at = NOW()
     WHERE status = 'pending' AND created_at <= NOW() - ($1 || ' hours')::interval
     RETURNING id`,
    [String(olderThanHours)]
  )
  const cancelled = result.rowCount ?? 0
  if (cancelled > 0) {
    log.info('Cancelled stale pending jobs', { count: cancelled, olderThanHours })
  }
  return { cancelled }
}

export async function recoverOnRestart(): Promise<{
  processingRecovered: number
  warmupRecovered: number
  staleCancelled: number
}> {
  const { recovered: processingRecovered } = await recoverStuckProcessingJobs()
  const { recovered: warmupRecovered } = await recoverStuckWarmupJobs()
  const { cancelled: staleCancelled } = await cancelStalePendingJobs()
  log.info('Queue recovery on restart complete', { processingRecovered, warmupRecovered, staleCancelled })
  return { processingRecovered, warmupRecovered, staleCancelled }
}
