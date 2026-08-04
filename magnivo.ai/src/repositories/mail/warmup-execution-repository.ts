import pool from '@/lib/db'
import type { WarmupExecution, WarmupExecutionStatus } from '@/types/mail'

type WarmupExecutionRow = {
  id: string
  job_id: string
  config_id: string
  organization_id: string
  status: WarmupExecutionStatus
  recipient_email: string
  subject: string
  sent_at: string | null
  delivered_at: string | null
  bounced_at: string | null
  failed_at: string | null
  error_message: string | null
  smtp_message_id: string | null
  duration_ms: number | null
  metadata: Record<string, unknown>
  created_at: string
}

function mapRow(row: WarmupExecutionRow): WarmupExecution {
  return {
    id: row.id,
    jobId: row.job_id,
    configId: row.config_id,
    organizationId: row.organization_id,
    status: row.status,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
    bouncedAt: row.bounced_at,
    failedAt: row.failed_at,
    errorMessage: row.error_message,
    smtpMessageId: row.smtp_message_id,
    durationMs: row.duration_ms,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

export async function findExecutionById(id: string): Promise<WarmupExecution | null> {
  const result = await pool.query<WarmupExecutionRow>(
    `SELECT * FROM public.warmup_executions WHERE id = $1`,
    [id]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findExecutionsByJobId(jobId: string): Promise<WarmupExecution[]> {
  const result = await pool.query<WarmupExecutionRow>(
    `SELECT * FROM public.warmup_executions WHERE job_id = $1 ORDER BY created_at ASC`,
    [jobId]
  )
  return result.rows.map(mapRow)
}

export async function findExecutionsByConfigId(configId: string, limit: number = 100): Promise<WarmupExecution[]> {
  const result = await pool.query<WarmupExecutionRow>(
    `SELECT * FROM public.warmup_executions WHERE config_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [configId, limit]
  )
  return result.rows.map(mapRow)
}

export async function findExecutionsByOrg(
  orgId: string,
  options?: { limit?: number; offset?: number; status?: WarmupExecutionStatus }
): Promise<WarmupExecution[]> {
  let query = `SELECT * FROM public.warmup_executions WHERE organization_id = $1`
  const values: unknown[] = [orgId]
  let paramIndex = 2

  if (options?.status) {
    query += ` AND status = $${paramIndex++}`
    values.push(options.status)
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

  const result = await pool.query<WarmupExecutionRow>(query, values)
  return result.rows.map(mapRow)
}

export async function insertExecution(data: {
  jobId: string
  configId: string
  organizationId: string
  status: WarmupExecutionStatus
  recipientEmail: string
  subject: string
  metadata?: Record<string, unknown>
}): Promise<WarmupExecution> {
  const result = await pool.query<WarmupExecutionRow>(
    `INSERT INTO public.warmup_executions
      (job_id, config_id, organization_id, status, recipient_email, subject, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.jobId, data.configId, data.organizationId,
      data.status, data.recipientEmail, data.subject,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateExecution(
  id: string,
  data: Partial<{
    status: WarmupExecutionStatus
    sentAt: string | null
    deliveredAt: string | null
    bouncedAt: string | null
    failedAt: string | null
    errorMessage: string | null
    smtpMessageId: string | null
    durationMs: number | null
    metadata: Record<string, unknown>
  }>
): Promise<WarmupExecution | null> {
  const fieldMap: Record<string, string> = {
    status: 'status', sentAt: 'sent_at', deliveredAt: 'delivered_at',
    bouncedAt: 'bounced_at', failedAt: 'failed_at',
    errorMessage: 'error_message', smtpMessageId: 'smtp_message_id',
    durationMs: 'duration_ms', metadata: 'metadata',
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
    return findExecutionById(id)
  }

  values.push(id)

  const result = await pool.query<WarmupExecutionRow>(
    `UPDATE public.warmup_executions SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function countExecutionsByOrgToday(orgId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.warmup_executions
     WHERE organization_id = $1 AND created_at >= CURRENT_DATE`,
    [orgId]
  )
  return result.rows[0]?.count ?? 0
}

export async function countExecutionsByStatus(
  orgId: string,
  since?: string
): Promise<Record<string, number>> {
  let query = `SELECT status, COUNT(*)::int AS count FROM public.warmup_executions WHERE organization_id = $1`
  const values: unknown[] = [orgId]

  if (since) {
    query += ` AND created_at >= $2`
    values.push(since)
  }

  query += ` GROUP BY status`

  const result = await pool.query(query, values)
  const counts: Record<string, number> = {}
  for (const row of result.rows) {
    counts[row.status] = row.count
  }
  return counts
}

export async function getAvgExecutionDuration(orgId: string, since?: string): Promise<number> {
  let query = `SELECT COALESCE(AVG(duration_ms), 0)::numeric AS avg_duration FROM public.warmup_executions WHERE organization_id = $1 AND status IN ('sent', 'delivered')`
  const values: unknown[] = [orgId]

  if (since) {
    query += ` AND created_at >= $2`
    values.push(since)
  }

  const result = await pool.query(query, values)
  return Math.round(Number(result.rows[0]?.avg_duration) || 0)
}

export async function getTodayExecutionStats(orgId: string): Promise<{
  total: number
  successful: number
  failed: number
  bounced: number
  pending: number
}> {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS successful,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
       COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
     FROM public.warmup_executions
     WHERE organization_id = $1 AND created_at >= CURRENT_DATE`,
    [orgId]
  )
  const row = result.rows[0]
  return {
    total: row?.total ?? 0,
    successful: row?.successful ?? 0,
    failed: row?.failed ?? 0,
    bounced: row?.bounced ?? 0,
    pending: row?.pending ?? 0,
  }
}
