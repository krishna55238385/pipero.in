import pool from '@/lib/db'
import type { WarmupMetrics, SchedulerStatus } from '@/types/mail'
import * as warmupJobRepo from '@/repositories/mail/warmup-job-repository'
import * as warmupExecRepo from '@/repositories/mail/warmup-execution-repository'

export async function getSchedulerState(): Promise<{
  status: SchedulerStatus
  lastHeartbeat: string | null
  lastRunAt: string | null
  lastRunDurationMs: number | null
  configsProcessed: number
  jobsCreated: number
  errorsCount: number
}> {
  const result = await pool.query(
    `SELECT * FROM public.warmup_scheduler_state WHERE id = 'singleton'`
  )
  const row = result.rows[0]
  if (!row) {
    return {
      status: 'stopped',
      lastHeartbeat: null,
      lastRunAt: null,
      lastRunDurationMs: null,
      configsProcessed: 0,
      jobsCreated: 0,
      errorsCount: 0,
    }
  }
  return {
    status: row.status,
    lastHeartbeat: row.last_heartbeat,
    lastRunAt: row.last_run_at,
    lastRunDurationMs: row.last_run_duration_ms,
    configsProcessed: row.configs_processed,
    jobsCreated: row.jobs_created,
    errorsCount: row.errors_count,
  }
}

export async function updateSchedulerState(data: Partial<{
  status: SchedulerStatus
  lastHeartbeat: string
  lastRunAt: string
  lastRunDurationMs: number
  configsProcessed: number
  jobsCreated: number
  errorsCount: number
  startedAt: string
  metadata: Record<string, unknown>
}>): Promise<void> {
  const fieldMap: Record<string, string> = {
    status: 'status', lastHeartbeat: 'last_heartbeat',
    lastRunAt: 'last_run_at', lastRunDurationMs: 'last_run_duration_ms',
    configsProcessed: 'configs_processed', jobsCreated: 'jobs_created',
    errorsCount: 'errors_count', startedAt: 'started_at', metadata: 'metadata',
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

  if (setClauses.length === 0) return

  setClauses.push(`updated_at = NOW()`)

  await pool.query(
    `UPDATE public.warmup_scheduler_state SET ${setClauses.join(', ')} WHERE id = 'singleton'`,
    values
  )
}

export async function recordHeartbeat(): Promise<void> {
  await updateSchedulerState({ lastHeartbeat: new Date().toISOString() })
}

export async function incrementConfigsProcessed(count: number = 1): Promise<void> {
  await pool.query(
    `UPDATE public.warmup_scheduler_state SET configs_processed = configs_processed + $1, updated_at = NOW() WHERE id = 'singleton'`,
    [count]
  )
}

export async function incrementJobsCreated(count: number = 1): Promise<void> {
  await pool.query(
    `UPDATE public.warmup_scheduler_state SET jobs_created = jobs_created + $1, updated_at = NOW() WHERE id = 'singleton'`,
    [count]
  )
}

export async function incrementErrorsCount(count: number = 1): Promise<void> {
  await pool.query(
    `UPDATE public.warmup_scheduler_state SET errors_count = errors_count + $1, updated_at = NOW() WHERE id = 'singleton'`,
    [count]
  )
}

export async function getMetrics(orgId: string): Promise<WarmupMetrics> {
  const state = await getSchedulerState()
  const todayStats = await warmupExecRepo.getTodayExecutionStats(orgId)
  const jobCounts = await warmupJobRepo.countJobsByOrg(orgId)
  const avgDuration = await warmupExecRepo.getAvgExecutionDuration(orgId)
  const totalExecutionsToday = todayStats.total
  const successRate = totalExecutionsToday > 0
    ? Math.round((todayStats.successful / totalExecutionsToday) * 100)
    : 100
  const failureRate = totalExecutionsToday > 0
    ? Math.round((todayStats.failed / totalExecutionsToday) * 100)
    : 0

  return {
    executionsToday: totalExecutionsToday,
    successRate,
    failureRate,
    avgExecutionDurationMs: avgDuration,
    mailboxUtilization: 0,
    poolUtilization: 0,
    schedulerStatus: state.status,
    lastHeartbeat: state.lastHeartbeat,
    queuedJobs: (jobCounts['pending'] ?? 0) + (jobCounts['queued'] ?? 0) + (jobCounts['retrying'] ?? 0),
    runningJobs: jobCounts['running'] ?? 0,
    failedJobs: jobCounts['failed'] ?? 0,
    totalJobsToday: Object.values(jobCounts).reduce((a, b) => a + b, 0),
  }
}

export async function recordAuditLog(data: {
  organizationId: string
  action: string
  actorUserId?: string
  actorEmail?: string
  configId?: string
  jobId?: string
  executionId?: string
  previousStatus?: string
  newStatus?: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.warmup_audit_log
      (organization_id, action, actor_user_id, actor_email, config_id, job_id, execution_id,
       previous_status, new_status, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      data.organizationId, data.action,
      data.actorUserId ?? null, data.actorEmail ?? null,
      data.configId ?? null, data.jobId ?? null, data.executionId ?? null,
      data.previousStatus ?? null, data.newStatus ?? null,
      data.message, JSON.stringify(data.metadata ?? {}),
    ]
  )
}

export async function getAuditLog(
  orgId: string,
  options?: { limit?: number; offset?: number; configId?: string }
): Promise<{
  id: string
  organizationId: string
  action: string
  actorUserId: string | null
  actorEmail: string | null
  configId: string | null
  jobId: string | null
  executionId: string | null
  previousStatus: string | null
  newStatus: string | null
  message: string | null
  metadata: Record<string, unknown>
  createdAt: string
}[]> {
  let query = `SELECT * FROM public.warmup_audit_log WHERE organization_id = $1`
  const values: unknown[] = [orgId]
  let paramIndex = 2

  if (options?.configId) {
    query += ` AND config_id = $${paramIndex++}`
    values.push(options.configId)
  }

  query += ` ORDER BY created_at DESC`

  if (options?.limit) {
    query += ` LIMIT $${paramIndex++}`
    values.push(options.limit)
  }

  if (options?.offset) {
    query += ` OFFSET $${paramIndex++}`
    values.push(options.offset)
  }

  const result = await pool.query(query, values)
  return result.rows.map(row => ({
    id: row.id,
    organizationId: row.organization_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    configId: row.config_id,
    jobId: row.job_id,
    executionId: row.execution_id,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    message: row.message,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }))
}
