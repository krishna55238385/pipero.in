import pool from '@/lib/db'
import type { MonitoringJob, MonitoringJobStatus, MonitoringJobType, MonitoringConfig } from '@/types/deliverability'

function mapMonitoringJobRow(row: Record<string, unknown>): MonitoringJob {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    jobType: row.job_type as MonitoringJobType,
    status: row.status as MonitoringJobStatus,
    domainId: row.domain_id as string | null,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
    durationMs: row.duration_ms as number | null,
    error: row.error as string | null,
    retryCount: row.retry_count as number,
    maxRetries: row.max_retries as number,
    nextRetryAt: row.next_retry_at as string | null,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function mapMonitoringConfigRow(row: Record<string, unknown>): MonitoringConfig {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    dnsVerificationEnabled: row.dns_verification_enabled as boolean,
    blacklistCheckEnabled: row.blacklist_check_enabled as boolean,
    reputationMonitoringEnabled: row.reputation_monitoring_enabled as boolean,
    postmasterSyncEnabled: row.postmaster_sync_enabled as boolean,
    sndsSyncEnabled: row.snds_sync_enabled as boolean,
    dnsCheckIntervalHours: row.dns_check_interval_hours as number,
    blacklistCheckIntervalHours: row.blacklist_check_interval_hours as number,
    reputationCheckIntervalHours: row.reputation_check_interval_hours as number,
    postmasterSyncIntervalHours: row.postmaster_sync_interval_hours as number,
    sndsSyncIntervalHours: row.snds_sync_interval_hours as number,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export async function createMonitoringJob(data: {
  organizationId: string
  jobType: MonitoringJobType
  domainId?: string
  maxRetries?: number
}): Promise<MonitoringJob> {
  const result = await pool.query(
    `INSERT INTO public.mail_monitoring_jobs
      (organization_id, job_type, domain_id, max_retries)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.organizationId, data.jobType, data.domainId ?? null, data.maxRetries ?? 3]
  )
  return mapMonitoringJobRow(result.rows[0] as Record<string, unknown>)
}

export async function updateMonitoringJob(id: string, data: {
  status?: MonitoringJobStatus
  startedAt?: string
  completedAt?: string
  durationMs?: number
  error?: string
  retryCount?: number
  nextRetryAt?: string | null
}): Promise<MonitoringJob | null> {
  const setClauses: string[] = []
  const values: (string | number | boolean | null)[] = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      setClauses.push(`${dbKey} = $${paramIndex}`)
      values.push(value as string | number | boolean | null)
      paramIndex++
    }
  }

  if (setClauses.length === 0) return null

  setClauses.push(`updated_at = NOW()`)
  values.push(id)

  const result = await pool.query(
    `UPDATE public.mail_monitoring_jobs
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapMonitoringJobRow(result.rows[0] as Record<string, unknown>) : null
}

export async function getPendingJobs(limit: number = 50): Promise<MonitoringJob[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_monitoring_jobs
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  )
  return result.rows.map(r => mapMonitoringJobRow(r as Record<string, unknown>))
}

export async function getRetriableJobs(): Promise<MonitoringJob[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_monitoring_jobs
     WHERE status = 'failed' AND retry_count < max_retries
       AND next_retry_at IS NOT NULL AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC
     LIMIT 20`,
  )
  return result.rows.map(r => mapMonitoringJobRow(r as Record<string, unknown>))
}

export async function getJobsByOrg(orgId: string, limit: number = 50): Promise<MonitoringJob[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_monitoring_jobs
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [orgId, limit]
  )
  return result.rows.map(r => mapMonitoringJobRow(r as Record<string, unknown>))
}

export async function cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
  const result = await pool.query(
    `DELETE FROM public.mail_monitoring_jobs
     WHERE status IN ('completed', 'cancelled')
       AND created_at < NOW() - INTERVAL '1 day' * $1`,
    [olderThanDays]
  )
  return result.rowCount ?? 0
}

export async function getMonitoringConfig(orgId: string): Promise<MonitoringConfig | null> {
  const result = await pool.query(
    `SELECT * FROM public.mail_monitoring_config
     WHERE organization_id = $1`,
    [orgId]
  )
  return result.rows[0] ? mapMonitoringConfigRow(result.rows[0] as Record<string, unknown>) : null
}

export async function upsertMonitoringConfig(orgId: string, data: Partial<{
  dnsVerificationEnabled: boolean
  blacklistCheckEnabled: boolean
  reputationMonitoringEnabled: boolean
  postmasterSyncEnabled: boolean
  sndsSyncEnabled: boolean
  dnsCheckIntervalHours: number
  blacklistCheckIntervalHours: number
  reputationCheckIntervalHours: number
  postmasterSyncIntervalHours: number
  sndsSyncIntervalHours: number
}>): Promise<MonitoringConfig> {
  const setClauses: string[] = []
  const values: (string | number | boolean | null)[] = []
  let paramIndex = 1

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      setClauses.push(`${dbKey} = $${paramIndex}`)
      values.push(value as string | number | boolean | null)
      paramIndex++
    }
  }

  if (setClauses.length === 0) {
    const existing = await getMonitoringConfig(orgId)
    if (existing) return existing
    const result = await pool.query(
      `INSERT INTO public.mail_monitoring_config (organization_id) VALUES ($1) RETURNING *`,
      [orgId]
    )
    return mapMonitoringConfigRow(result.rows[0] as Record<string, unknown>)
  }

  values.push(orgId)

  const result = await pool.query(
    `INSERT INTO public.mail_monitoring_config (organization_id)
     VALUES ($${paramIndex})
     ON CONFLICT (organization_id) DO UPDATE SET ${setClauses.map((s, i) => `${s.split(' = ')[0]} = EXCLUDED.${s.split(' = ')[0]}`).join(', ')}, updated_at = NOW()
     RETURNING *`,
    values
  )
  return mapMonitoringConfigRow(result.rows[0] as Record<string, unknown>)
}
