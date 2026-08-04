import pool from '@/lib/db'
import type { Mailbox, MailboxProvider, AuthType, MailboxStatus, MailboxHealth, MailboxVerificationStatus, WarmupStatus, OAuthConfig, SMTPConfig, IMAPConfig } from '@/types/mail'

type MailboxRow = {
  id: string
  organization_id: string
  pool_id: string | null
  provider: MailboxProvider
  auth_type: AuthType
  email: string
  display_name: string
  sender_name: string
  provider_account_id: string | null
  timezone: string
  daily_limit: number
  current_daily_usage: number
  health_score: number | null
  health_status: MailboxHealth
  mailbox_status: MailboxStatus
  verification_status: MailboxVerificationStatus
  warmup_status: WarmupStatus
  last_verified_at: string | null
  last_verification_duration_ms: number | null
  last_verification_result: string | null
  deleted_at: string | null
  archived_at: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapRow(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    organizationId: row.organization_id,
    poolId: row.pool_id,
    provider: row.provider,
    authType: row.auth_type,
    email: row.email,
    displayName: row.display_name,
    senderName: row.sender_name,
    providerAccountId: row.provider_account_id,
    timezone: row.timezone,
    dailyLimit: row.daily_limit,
    hourlySendLimit: (row as { hourly_send_limit?: number }).hourly_send_limit,
    currentDailyUsage: row.current_daily_usage,
    healthScore: row.health_score,
    healthStatus: row.health_status,
    mailboxStatus: row.mailbox_status,
    verificationStatus: row.verification_status,
    warmupStatus: row.warmup_status,
    lastVerifiedAt: row.last_verified_at,
    lastVerificationDurationMs: row.last_verification_duration_ms,
    lastVerificationResult: row.last_verification_result,
    deletedAt: row.deleted_at,
    archivedAt: row.archived_at,
    oauthConfig: null,
    smtpConfig: null,
    imapConfig: null,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findMailboxesByOrg(orgId: string): Promise<Mailbox[]> {
  const result = await pool.query<MailboxRow>(
    `SELECT * FROM public.mail_mailboxes WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapRow)
}

export async function findMailboxById(id: string, orgId: string): Promise<Mailbox | null> {
  const result = await pool.query<MailboxRow>(
    `SELECT * FROM public.mail_mailboxes WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export type MailboxDomainGroup = {
  domain: string
  mailboxes: Mailbox[]
  totalCount: number
}

export async function findMailboxesGroupedByDomain(orgId: string): Promise<MailboxDomainGroup[]> {
  const result = await pool.query<MailboxRow>(
    `SELECT * FROM public.mail_mailboxes
     WHERE organization_id = $1 AND deleted_at IS NULL
     ORDER BY email ASC`,
    [orgId]
  )
  const groups = new Map<string, Mailbox[]>()
  for (const row of result.rows) {
    const parts = row.email.split('@')
    const domain = parts.length === 2 ? parts[1].toLowerCase() : 'unknown'
    if (!groups.has(domain)) groups.set(domain, [])
    groups.get(domain)!.push(mapRow(row))
  }
  return Array.from(groups.entries())
    .map(([domain, mailboxes]) => ({ domain, mailboxes, totalCount: mailboxes.length }))
    .sort((a, b) => a.domain.localeCompare(b.domain))
}

export async function findMailboxByEmail(email: string, orgId: string): Promise<Mailbox | null> {
  const result = await pool.query<MailboxRow>(
    `SELECT * FROM public.mail_mailboxes WHERE LOWER(email) = LOWER($1) AND organization_id = $2 AND deleted_at IS NULL`,
    [email, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function checkDuplicateMailbox(email: string, orgId: string, excludeId?: string): Promise<boolean> {
  const conditions = ['LOWER(email) = LOWER($1)', 'organization_id = $2', 'deleted_at IS NULL']
  const values: (string | number)[] = [email, orgId]
  if (excludeId) {
    conditions.push('id != $3')
    values.push(excludeId)
  }
  const result = await pool.query(
    `SELECT 1 FROM public.mail_mailboxes WHERE ${conditions.join(' AND ')} LIMIT 1`,
    values
  )
  return (result.rowCount ?? 0) > 0
}

export async function insertMailbox(
  orgId: string,
  data: {
    email: string
    displayName: string
    senderName: string
    provider: MailboxProvider
    authType: AuthType
    timezone: string
    dailyLimit: number
    poolId: string | null
    providerAccountId: string | null
    metadata: Record<string, unknown>
  }
): Promise<Mailbox> {
  const result = await pool.query<MailboxRow>(
    `INSERT INTO public.mail_mailboxes
      (organization_id, pool_id, provider, auth_type, email, display_name, sender_name,
       provider_account_id, timezone, daily_limit, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      orgId,
      data.poolId,
      data.provider,
      data.authType,
      data.email,
      data.displayName,
      data.senderName,
      data.providerAccountId,
      data.timezone,
      data.dailyLimit,
      JSON.stringify(data.metadata),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateMailbox(
  id: string,
  orgId: string,
  data: {
    displayName?: string
    senderName?: string
    timezone?: string
    dailyLimit?: number
    poolId?: string | null
    metadata?: Record<string, unknown>
  }
): Promise<Mailbox | null> {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (data.displayName !== undefined) {
    setClauses.push(`display_name = $${paramIndex++}`)
    values.push(data.displayName)
  }
  if (data.senderName !== undefined) {
    setClauses.push(`sender_name = $${paramIndex++}`)
    values.push(data.senderName)
  }
  if (data.timezone !== undefined) {
    setClauses.push(`timezone = $${paramIndex++}`)
    values.push(data.timezone)
  }
  if (data.dailyLimit !== undefined) {
    setClauses.push(`daily_limit = $${paramIndex++}`)
    values.push(data.dailyLimit)
  }
  if (data.poolId !== undefined) {
    setClauses.push(`pool_id = $${paramIndex++}`)
    values.push(data.poolId)
  }
  if (data.metadata !== undefined) {
    setClauses.push(`metadata = $${paramIndex++}`)
    values.push(JSON.stringify(data.metadata))
  }

  if (setClauses.length === 0) {
    return findMailboxById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<MailboxRow>(
    `UPDATE public.mail_mailboxes SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function deleteMailbox(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_mailboxes WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function findMailboxesByPoolId(poolId: string, orgId: string): Promise<Mailbox[]> {
  const result = await pool.query<MailboxRow>(
    `SELECT m.* FROM public.mail_mailboxes m
     JOIN public.mailbox_pool_members pm ON pm.mailbox_id = m.id
     WHERE pm.pool_id = $1 AND m.organization_id = $2
     ORDER BY m.created_at DESC`,
    [poolId, orgId]
  )
  return result.rows.map(mapRow)
}

export async function countMailboxesByOrg(orgId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_mailboxes WHERE organization_id = $1`,
    [orgId]
  )
  return result.rows[0]?.count ?? 0
}

export type PaginatedMailboxRow = {
  id: string
  email: string
  display_name: string
  provider: MailboxProvider
  pool_id: string | null
  pool_name: string | null
  health_score: number | null
  health_status: MailboxHealth
  mailbox_status: MailboxStatus
  verification_status: MailboxVerificationStatus
  warmup_status: WarmupStatus
  daily_limit: number
  current_daily_usage: number
  auth_type: AuthType
  created_at: string
}

export type DashboardStatsRow = {
  total: number
  connected: number
  needs_attention: number
  oauth_expired: number
  smtp_errors: number
  daily_capacity: number
}

type FindPaginatedInput = {
  orgId: string
  search?: string
  status?: MailboxStatus | 'all'
  provider?: MailboxProvider | 'all'
  health?: MailboxHealth | 'all'
  poolId?: string | 'all'
  warmupStatus?: WarmupStatus | 'all'
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  offset: number
  limit: number
}

function buildWhereClause(input: FindPaginatedInput): { where: string; values: unknown[] } {
  const conditions: string[] = ['m.organization_id = $1', 'm.deleted_at IS NULL']
  const values: unknown[] = [input.orgId]
  let paramIndex = 2

  if (input.search && input.search.trim()) {
    conditions.push(`(m.email ILIKE $${paramIndex} OR m.display_name ILIKE $${paramIndex})`)
    values.push(`%${input.search.trim()}%`)
    paramIndex++
  }

  if (input.status && input.status !== 'all') {
    conditions.push(`m.mailbox_status = $${paramIndex}`)
    values.push(input.status)
    paramIndex++
  }

  if (input.provider && input.provider !== 'all') {
    conditions.push(`m.provider = $${paramIndex}`)
    values.push(input.provider)
    paramIndex++
  }

  if (input.health && input.health !== 'all') {
    conditions.push(`m.health_status = $${paramIndex}`)
    values.push(input.health)
    paramIndex++
  }

  if (input.poolId && input.poolId !== 'all') {
    if (input.poolId === 'none') {
      conditions.push(`m.pool_id IS NULL`)
    } else {
      conditions.push(`m.pool_id = $${paramIndex}`)
      values.push(input.poolId)
      paramIndex++
    }
  }

  if (input.warmupStatus && input.warmupStatus !== 'all') {
    conditions.push(`m.warmup_status = $${paramIndex}`)
    values.push(input.warmupStatus)
    paramIndex++
  }

  return { where: conditions.join(' AND '), values }
}

const SORT_COLUMN_MAP: Record<string, string> = {
  email: 'm.email',
  displayName: 'm.display_name',
  provider: 'm.provider',
  mailboxStatus: 'm.mailbox_status',
  healthScore: 'm.health_score',
  dailyLimit: 'm.daily_limit',
  currentDailyUsage: 'm.current_daily_usage',
  warmupStatus: 'm.warmup_status',
  verificationStatus: 'm.verification_status',
  createdAt: 'm.created_at',
  poolName: 'p.name',
}

export async function findMailboxesPaginated(input: FindPaginatedInput): Promise<PaginatedMailboxRow[]> {
  const { where, values } = buildWhereClause(input)
  const sortCol = SORT_COLUMN_MAP[input.sortBy ?? 'createdAt'] ?? 'm.created_at'
  const sortDir = input.sortDirection === 'asc' ? 'ASC' : 'DESC'
  const limitParam = values.length + 1
  const offsetParam = values.length + 2

  const result = await pool.query<PaginatedMailboxRow>(
    `SELECT
       m.id, m.email, m.display_name, m.provider, m.pool_id,
       p.name AS pool_name,
       m.health_score, m.health_status, m.mailbox_status,
       m.verification_status, m.warmup_status,
       m.daily_limit, m.current_daily_usage, m.auth_type,
       m.created_at
     FROM public.mail_mailboxes m
     LEFT JOIN public.mailbox_pools p ON p.id = m.pool_id
     WHERE ${where}
     ORDER BY ${sortCol} ${sortDir} NULLS LAST
     LIMIT $${limitParam} OFFSET $${offsetParam}`,
    [...values, input.limit, input.offset]
  )
  return result.rows
}

export async function countMailboxesFiltered(input: { orgId: string; search?: string; status?: MailboxStatus | 'all'; provider?: MailboxProvider | 'all'; health?: MailboxHealth | 'all'; poolId?: string | 'all'; warmupStatus?: WarmupStatus | 'all' }): Promise<number> {
  const { where, values } = buildWhereClause(input as FindPaginatedInput)
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_mailboxes m WHERE ${where}`,
    values
  )
  return result.rows[0]?.count ?? 0
}

export async function getDashboardStats(orgId: string): Promise<DashboardStatsRow> {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM public.mail_mailboxes WHERE organization_id = $1) AS total,
       (SELECT COUNT(*)::int FROM public.mail_mailboxes WHERE organization_id = $1 AND mailbox_status = 'connected') AS connected,
       (SELECT COUNT(*)::int FROM public.mail_mailboxes WHERE organization_id = $1 AND (health_status IN ('poor', 'unknown') OR mailbox_status = 'error')) AS needs_attention,
       (SELECT COUNT(*)::int FROM public.mailbox_oauth_configs oc
        JOIN public.mail_mailboxes m ON m.id = oc.mailbox_id
        WHERE m.organization_id = $1 AND oc.token_expires_at < NOW()) AS oauth_expired,
       (SELECT COUNT(*)::int FROM public.mailbox_smtp_configs sc
        JOIN public.mail_mailboxes m ON m.id = sc.mailbox_id
        WHERE m.organization_id = $1 AND sc.validation_status = 'invalid') AS smtp_errors,
       (SELECT COALESCE(SUM(daily_limit), 0)::int FROM public.mail_mailboxes WHERE organization_id = $1) AS daily_capacity`,
    [orgId]
  )
  const row = result.rows[0]
  return {
    total: row?.total ?? 0,
    connected: row?.connected ?? 0,
    needs_attention: row?.needs_attention ?? 0,
    oauth_expired: row?.oauth_expired ?? 0,
    smtp_errors: row?.smtp_errors ?? 0,
    daily_capacity: row?.daily_capacity ?? 0,
  }
}

export async function updateMailboxStatus(
  id: string,
  orgId: string,
  status: MailboxStatus
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.mail_mailboxes SET mailbox_status = $1, updated_at = NOW()
     WHERE id = $2 AND organization_id = $3 AND deleted_at IS NULL`,
    [status, id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function updateMailboxesStatus(
  ids: string[],
  orgId: string,
  status: MailboxStatus
): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.mail_mailboxes SET mailbox_status = $${ids.length + 1}, updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 2} AND deleted_at IS NULL`,
    [...ids, status, orgId]
  )
  return result.rowCount ?? 0
}

export async function assignMailboxesToPool(
  ids: string[],
  poolId: string | null,
  orgId: string
): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.mail_mailboxes SET pool_id = $${ids.length + 1}, updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 2} AND deleted_at IS NULL`,
    [poolId, ...ids, orgId]
  )
  return result.rowCount ?? 0
}

export async function archiveMailboxes(
  ids: string[],
  orgId: string
): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.mail_mailboxes
     SET mailbox_status = 'archived', archived_at = NOW(), updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 1} AND deleted_at IS NULL`,
    [...ids, orgId]
  )
  return result.rowCount ?? 0
}

export async function softDeleteMailboxes(
  ids: string[],
  orgId: string
): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.mail_mailboxes
     SET mailbox_status = 'deleted', deleted_at = NOW(), updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 1} AND deleted_at IS NULL`,
    [...ids, orgId]
  )
  return result.rowCount ?? 0
}

export async function restoreMailboxes(
  ids: string[],
  orgId: string
): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.mail_mailboxes
     SET mailbox_status = 'connected', deleted_at = NULL, archived_at = NULL, updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 1}`,
    [...ids, orgId]
  )
  return result.rowCount ?? 0
}

export async function updateMailboxVerificationInfo(
  id: string,
  orgId: string,
  data: {
    verificationStatus: string
    lastVerifiedAt: string
    lastVerificationDurationMs: number
    lastVerificationResult: string
  }
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.mail_mailboxes
     SET verification_status = $1, last_verified_at = $2, last_verification_duration_ms = $3,
         last_verification_result = $4, updated_at = NOW()
     WHERE id = $5 AND organization_id = $6`,
    [data.verificationStatus, data.lastVerifiedAt, data.lastVerificationDurationMs, data.lastVerificationResult, id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function transitionMailboxStatus(
  id: string,
  orgId: string,
  newStatus: MailboxStatus,
  extra?: { archivedAt?: string }
): Promise<{ previousStatus: MailboxStatus | null; updated: boolean }> {
  const current = await pool.query<MailboxRow>(
    `SELECT mailbox_status FROM public.mail_mailboxes WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
    [id, orgId]
  )
  const previousStatus = current.rows[0]?.mailbox_status ?? null

  const setClauses = [`mailbox_status = $1`, `updated_at = NOW()`]
  const values: unknown[] = [newStatus]
  let paramIndex = 2

  if (extra?.archivedAt !== undefined) {
    setClauses.push(`archived_at = $${paramIndex++}`)
    values.push(extra.archivedAt)
  }

  values.push(id, orgId)

  const result = await pool.query(
    `UPDATE public.mail_mailboxes SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1} AND deleted_at IS NULL`,
    values
  )

  return { previousStatus, updated: (result.rowCount ?? 0) > 0 }
}

export type MailboxWithConfigs = Mailbox & {
  oauthConfig: OAuthConfig | null
  smtpConfig: SMTPConfig | null
  imapConfig: IMAPConfig | null
}

export async function findMailboxWithConfigs(id: string, orgId: string): Promise<MailboxWithConfigs | null> {
  const mailbox = await findMailboxById(id, orgId)
  if (!mailbox) return null

  const [oauthRow, smtpRow, imapRow] = await Promise.all([
    pool.query(
      `SELECT * FROM public.mailbox_oauth_configs WHERE mailbox_id = $1 LIMIT 1`,
      [id]
    ),
    pool.query(
      `SELECT * FROM public.mailbox_smtp_configs WHERE mailbox_id = $1 LIMIT 1`,
      [id]
    ),
    pool.query(
      `SELECT * FROM public.mailbox_imap_configs WHERE mailbox_id = $1 LIMIT 1`,
      [id]
    ),
  ])

  const oauthConfig: OAuthConfig | null = oauthRow.rows[0] ? {
    id: oauthRow.rows[0].id,
    mailboxId: oauthRow.rows[0].mailbox_id,
    organizationId: oauthRow.rows[0].organization_id,
    provider: oauthRow.rows[0].provider,
    providerAccountId: oauthRow.rows[0].provider_account_id,
    encryptedRefreshToken: oauthRow.rows[0].encrypted_refresh_token,
    encryptedAccessToken: oauthRow.rows[0].encrypted_access_token,
    tokenExpiresAt: oauthRow.rows[0].token_expires_at,
    scope: oauthRow.rows[0].scope,
    lastRotatedAt: oauthRow.rows[0].last_rotated_at,
    createdAt: oauthRow.rows[0].created_at,
    updatedAt: oauthRow.rows[0].updated_at,
  } : null

  const smtpConfig: SMTPConfig | null = smtpRow.rows[0] ? {
    id: smtpRow.rows[0].id,
    mailboxId: smtpRow.rows[0].mailbox_id,
    organizationId: smtpRow.rows[0].organization_id,
    smtpHost: smtpRow.rows[0].smtp_host,
    smtpPort: smtpRow.rows[0].smtp_port,
    encryption: smtpRow.rows[0].encryption,
    username: smtpRow.rows[0].username,
    encryptedPasswordReference: smtpRow.rows[0].encrypted_password_reference,
    authenticationType: smtpRow.rows[0].authentication_type,
    validationStatus: smtpRow.rows[0].validation_status,
    lastValidatedAt: smtpRow.rows[0].last_validated_at,
    createdAt: smtpRow.rows[0].created_at,
    updatedAt: smtpRow.rows[0].updated_at,
  } : null

  const imapConfig: IMAPConfig | null = imapRow.rows[0] ? {
    id: imapRow.rows[0].id,
    mailboxId: imapRow.rows[0].mailbox_id,
    organizationId: imapRow.rows[0].organization_id,
    host: imapRow.rows[0].host,
    port: imapRow.rows[0].port,
    ssl: imapRow.rows[0].ssl,
    username: imapRow.rows[0].username || '',
    encryptedPasswordReference: imapRow.rows[0].encrypted_password_reference ?? null,
    authentication: imapRow.rows[0].authentication,
    validationStatus: imapRow.rows[0].validation_status,
    lastValidatedAt: imapRow.rows[0].last_validated_at,
    createdAt: imapRow.rows[0].created_at,
    updatedAt: imapRow.rows[0].updated_at,
  } : null

  return {
    ...mailbox,
    oauthConfig,
    smtpConfig,
    imapConfig,
  }
}
