import pool from '@/lib/db'
import type { WarmupJob, WarmupJobStatus } from '@/types/mail'

type WarmupJobRow = {
  id: string
  config_id: string
  organization_id: string
  status: WarmupJobStatus
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  retry_count: number
  max_retries: number
  next_retry_at: string | null
  last_error: string | null
  error_category: string | null
  target_sends: number
  completed_sends: number
  failed_sends: number
  mailbox_id: string
  pool_id: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapRow(row: WarmupJobRow): WarmupJob {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    retryCount: row.retry_count,
    maxRetries: row.max_retries,
    nextRetryAt: row.next_retry_at,
    lastError: row.last_error,
    errorCategory: row.error_category,
    targetSends: row.target_sends,
    completedSends: row.completed_sends,
    failedSends: row.failed_sends,
    mailboxId: row.mailbox_id,
    poolId: row.pool_id,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findJobById(id: string): Promise<WarmupJob | null> {
  const result = await pool.query<WarmupJobRow>(
    `SELECT * FROM public.warmup_jobs WHERE id = $1`,
    [id]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findJobsByConfigId(configId: string): Promise<WarmupJob[]> {
  const result = await pool.query<WarmupJobRow>(
    `SELECT * FROM public.warmup_jobs WHERE config_id = $1 ORDER BY scheduled_at DESC`,
    [configId]
  )
  return result.rows.map(mapRow)
}

export async function findJobsByOrg(orgId: string, status?: WarmupJobStatus): Promise<WarmupJob[]> {
  if (status) {
    const result = await pool.query<WarmupJobRow>(
      `SELECT * FROM public.warmup_jobs WHERE organization_id = $1 AND status = $2 ORDER BY scheduled_at DESC`,
      [orgId, status]
    )
    return result.rows.map(mapRow)
  }
  const result = await pool.query<WarmupJobRow>(
    `SELECT * FROM public.warmup_jobs WHERE organization_id = $1 ORDER BY scheduled_at DESC`,
    [orgId]
  )
  return result.rows.map(mapRow)
}

export async function findRunnableJobs(): Promise<WarmupJob[]> {
  const result = await pool.query<WarmupJobRow>(
    `SELECT * FROM public.warmup_jobs
     WHERE status IN ('pending', 'queued', 'retrying')
       AND scheduled_at <= NOW()
       AND (next_retry_at IS NULL OR next_retry_at <= NOW())
     ORDER BY scheduled_at ASC`
  )
  return result.rows.map(mapRow)
}

export async function findStuckJobs(timeoutMinutes: number = 30): Promise<WarmupJob[]> {
  const result = await pool.query<WarmupJobRow>(
    `SELECT * FROM public.warmup_jobs
     WHERE status = 'running'
       AND started_at < NOW() - INTERVAL '1 minute' * $1`,
    [timeoutMinutes]
  )
  return result.rows.map(mapRow)
}

export async function findFailedJobsForRetry(): Promise<WarmupJob[]> {
  const result = await pool.query<WarmupJobRow>(
    `SELECT * FROM public.warmup_jobs
     WHERE status = 'retrying'
       AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC`
  )
  return result.rows.map(mapRow)
}

export async function insertJob(data: {
  configId: string
  organizationId: string
  status: WarmupJobStatus
  scheduledAt: string
  targetSends: number
  mailboxId: string
  poolId: string | null
  maxRetries?: number
  metadata?: Record<string, unknown>
}): Promise<WarmupJob> {
  const result = await pool.query<WarmupJobRow>(
    `INSERT INTO public.warmup_jobs
      (config_id, organization_id, status, scheduled_at, target_sends, mailbox_id, pool_id, max_retries, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.configId, data.organizationId, data.status, data.scheduledAt,
      data.targetSends, data.mailboxId, data.poolId,
      data.maxRetries ?? 3,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateJob(
  id: string,
  data: Partial<{
    status: WarmupJobStatus
    startedAt: string | null
    completedAt: string | null
    retryCount: number
    nextRetryAt: string | null
    lastError: string | null
    errorCategory: string | null
    completedSends: number
    failedSends: number
    metadata: Record<string, unknown>
  }>
): Promise<WarmupJob | null> {
  const fieldMap: Record<string, string> = {
    status: 'status', startedAt: 'started_at', completedAt: 'completed_at',
    retryCount: 'retry_count', nextRetryAt: 'next_retry_at',
    lastError: 'last_error', errorCategory: 'error_category',
    completedSends: 'completed_sends', failedSends: 'failed_sends',
    metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = (data as Record<string, unknown>)[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(key === 'metadata' ? JSON.stringify(val) : val)
    }
  }

  if (setClauses.length === 0) {
    return findJobById(id)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id)

  const result = await pool.query<WarmupJobRow>(
    `UPDATE public.warmup_jobs SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function countJobsByOrg(orgId: string): Promise<Record<WarmupJobStatus, number>> {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM public.warmup_jobs WHERE organization_id = $1
     GROUP BY status`,
    [orgId]
  )
  const counts = {} as Record<WarmupJobStatus, number>
  for (const row of result.rows) {
    counts[row.status as WarmupJobStatus] = row.count
  }
  return counts
}

export async function countJobsByStatus(status: WarmupJobStatus): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.warmup_jobs WHERE status = $1`,
    [status]
  )
  return result.rows[0]?.count ?? 0
}

export async function deleteJobsByConfigId(configId: string): Promise<number> {
  const result = await pool.query(
    `DELETE FROM public.warmup_jobs WHERE config_id = $1 AND status IN ('completed', 'failed', 'cancelled', 'skipped')`,
    [configId]
  )
  return result.rowCount ?? 0
}

export async function cancelPendingJobsByConfigId(configId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE public.warmup_jobs SET status = 'cancelled', updated_at = NOW()
     WHERE config_id = $1 AND status IN ('pending', 'queued', 'retrying')`,
    [configId]
  )
  return result.rowCount ?? 0
}
