import pool from '@/lib/db'
import type {
  MailboxPool,
  PoolHealthAggregation,
  PoolStatus,
  SendingStrategy,
  RotationStrategy,
  PoolMembershipRole,
  PoolHealthWarning,
} from '@/types/mail'

type PoolRow = {
  id: string
  organization_id: string
  name: string
  description: string
  status: PoolStatus
  daily_pool_limit: number
  sending_strategy: SendingStrategy
  rotation_strategy: RotationStrategy
  max_concurrent_sends: number
  timezone: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapRow(row: PoolRow, health?: PoolHealthAggregation): MailboxPool {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    status: row.status,
    dailyPoolLimit: row.daily_pool_limit,
    sendingStrategy: row.sending_strategy ?? 'standard',
    rotationStrategy: row.rotation_strategy ?? 'round_robin',
    maxConcurrentSends: row.max_concurrent_sends ?? 5,
    timezone: row.timezone ?? 'UTC',
    memberMailboxes: [],
    healthAggregation: health ?? null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function fetchPoolHealth(poolId: string): Promise<PoolHealthAggregation> {
  const result = await pool.query(
    `SELECT
       COALESCE(AVG(health_score), 0)::int AS avg_health_score,
       COUNT(*)::int AS total_mailboxes,
       COUNT(*) FILTER (WHERE mailbox_status = 'connected')::int AS connected_count,
       COUNT(*) FILTER (WHERE mailbox_status = 'warming')::int AS warming_count,
       COUNT(*) FILTER (WHERE mailbox_status = 'error')::int AS error_count,
       COALESCE(SUM(daily_limit), 0)::int AS total_daily_capacity,
       COALESCE(SUM(current_daily_usage), 0)::int AS used_today
     FROM public.mail_mailboxes
     WHERE pool_id = $1 AND deleted_at IS NULL`,
    [poolId]
  )
  const row = result.rows[0]

  const warnings: PoolHealthWarning[] = []
  const avgScore = row?.avg_health_score ?? 0
  if (avgScore < 50 && row?.total_mailboxes > 0) {
    warnings.push({ type: 'low_health', message: `Pool average health is ${avgScore}%`, severity: 'warning' })
  }
  if (row?.error_count > 0) {
    warnings.push({ type: 'mailbox_error', message: `${row.error_count} mailbox(es) in error state`, severity: 'critical' })
  }

  return {
    avgHealthScore: avgScore,
    totalMailboxes: row?.total_mailboxes ?? 0,
    connectedCount: row?.connected_count ?? 0,
    warmingCount: row?.warming_count ?? 0,
    errorCount: row?.error_count ?? 0,
    totalDailyCapacity: row?.total_daily_capacity ?? 0,
    usedToday: row?.used_today ?? 0,
    warnings,
  }
}

export async function findPoolsByOrg(orgId: string): Promise<MailboxPool[]> {
  const result = await pool.query<PoolRow>(
    `SELECT * FROM public.mailbox_pools WHERE organization_id = $1 ORDER BY created_at DESC`,
    [orgId]
  )
  const pools: MailboxPool[] = []
  for (const row of result.rows) {
    const health = await fetchPoolHealth(row.id)
    pools.push(mapRow(row, health))
  }
  return pools
}

export async function findPoolById(id: string, orgId: string): Promise<MailboxPool | null> {
  const result = await pool.query<PoolRow>(
    `SELECT * FROM public.mailbox_pools WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  if (!result.rows[0]) return null
  const health = await fetchPoolHealth(id)
  return mapRow(result.rows[0], health)
}

export async function checkDuplicatePool(name: string, orgId: string, excludeId?: string): Promise<boolean> {
  const conditions = ['LOWER(name) = LOWER($1)', 'organization_id = $2']
  const values: (string | number)[] = [name, orgId]
  if (excludeId) {
    conditions.push('id != $3')
    values.push(excludeId)
  }
  const result = await pool.query(
    `SELECT 1 FROM public.mailbox_pools WHERE ${conditions.join(' AND ')} LIMIT 1`,
    values
  )
  return (result.rowCount ?? 0) > 0
}

export async function insertPool(
  orgId: string,
  data: {
    name: string
    description: string
    dailyPoolLimit: number
    sendingStrategy?: SendingStrategy
    rotationStrategy?: RotationStrategy
    maxConcurrentSends?: number
    timezone?: string
    metadata: Record<string, unknown>
  }
): Promise<MailboxPool> {
  const result = await pool.query<PoolRow>(
    `INSERT INTO public.mailbox_pools
      (organization_id, name, description, daily_pool_limit, sending_strategy, rotation_strategy, max_concurrent_sends, timezone, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      orgId, data.name, data.description, data.dailyPoolLimit,
      data.sendingStrategy ?? 'standard',
      data.rotationStrategy ?? 'round_robin',
      data.maxConcurrentSends ?? 5,
      data.timezone ?? 'UTC',
      JSON.stringify(data.metadata),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updatePool(
  id: string,
  orgId: string,
  data: {
    name?: string
    description?: string
    status?: PoolStatus
    dailyPoolLimit?: number
    sendingStrategy?: SendingStrategy
    rotationStrategy?: RotationStrategy
    maxConcurrentSends?: number
    timezone?: string
    metadata?: Record<string, unknown>
  }
): Promise<MailboxPool | null> {
  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    status: 'status',
    dailyPoolLimit: 'daily_pool_limit',
    sendingStrategy: 'sending_strategy',
    rotationStrategy: 'rotation_strategy',
    maxConcurrentSends: 'max_concurrent_sends',
    timezone: 'timezone',
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
    return findPoolById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<PoolRow>(
    `UPDATE public.mailbox_pools SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  if (!result.rows[0]) return null
  const health = await fetchPoolHealth(id)
  return mapRow(result.rows[0], health)
}

export async function deletePool(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mailbox_pools WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function addMailboxToPool(
  poolId: string,
  mailboxId: string,
  role: PoolMembershipRole = 'primary'
): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO public.mailbox_pool_members (pool_id, mailbox_id, role)
     VALUES ($1, $2, $3) ON CONFLICT (pool_id, mailbox_id) DO UPDATE SET role = EXCLUDED.role`,
    [poolId, mailboxId, role]
  )
  return (result.rowCount ?? 0) > 0
}

export async function removeMailboxFromPool(poolId: string, mailboxId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mailbox_pool_members WHERE pool_id = $1 AND mailbox_id = $2`,
    [poolId, mailboxId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function updateMailboxPoolRole(
  poolId: string,
  mailboxId: string,
  role: PoolMembershipRole
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.mailbox_pool_members SET role = $3
     WHERE pool_id = $1 AND mailbox_id = $2`,
    [poolId, mailboxId, role]
  )
  return (result.rowCount ?? 0) > 0
}

export async function findPoolMembersWithDetails(poolId: string): Promise<{
  mailboxId: string
  email: string
  role: PoolMembershipRole
  healthScore: number | null
  healthStatus: string
  mailboxStatus: string
  dailyLimit: number
  currentUsage: number
  provider: string
  addedAt: string
}[]> {
  const result = await pool.query(
    `SELECT
       m.id AS mailbox_id, m.email, mpm.role,
       m.health_score, m.health_status, m.mailbox_status,
       m.daily_limit, m.current_daily_usage, m.provider,
       mpm.added_at
     FROM public.mailbox_pool_members mpm
     JOIN public.mail_mailboxes m ON m.id = mpm.mailbox_id
     WHERE mpm.pool_id = $1 AND m.deleted_at IS NULL
     ORDER BY mpm.role, m.email`,
    [poolId]
  )
  return result.rows.map((r) => ({
    mailboxId: r.mailbox_id,
    email: r.email,
    role: r.role,
    healthScore: r.health_score,
    healthStatus: r.health_status,
    mailboxStatus: r.mailbox_status,
    dailyLimit: r.daily_limit,
    currentUsage: r.current_daily_usage,
    provider: r.provider,
    addedAt: r.added_at,
  }))
}

export async function findAvailableMailboxes(orgId: string, poolId?: string): Promise<{
  id: string
  email: string
  provider: string
  healthScore: number | null
  healthStatus: string
  mailboxStatus: string
  poolId: string | null
  poolName: string | null
}[]> {
  const result = await pool.query(
    `SELECT m.id, m.email, m.provider, m.health_score, m.health_status,
            m.mailbox_status, m.pool_id, mp.name AS pool_name
     FROM public.mail_mailboxes m
     LEFT JOIN public.mailbox_pools mp ON mp.id = m.pool_id
     WHERE m.organization_id = $1 AND m.deleted_at IS NULL
     ORDER BY m.email`,
    [orgId]
  )
  return result.rows
}

export async function countPoolsByOrg(orgId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mailbox_pools WHERE organization_id = $1`,
    [orgId]
  )
  return result.rows[0]?.count ?? 0
}
