import pool from '@/lib/db'
import type { IMAPConfig, ValidationStatus } from '@/types/mail'

type IMAPConfigRow = {
  id: string
  mailbox_id: string
  organization_id: string
  host: string
  port: number
  ssl: boolean
  username: string
  encrypted_password_reference: string | null
  authentication: 'password' | 'oauth2'
  validation_status: ValidationStatus
  last_validated_at: string | null
  created_at: string
  updated_at: string
}

function mapRow(row: IMAPConfigRow): IMAPConfig {
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    organizationId: row.organization_id,
    host: row.host,
    port: row.port,
    ssl: row.ssl,
    username: row.username || '',
    encryptedPasswordReference: row.encrypted_password_reference,
    authentication: row.authentication,
    validationStatus: row.validation_status,
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findIMAPConfigByMailboxId(mailboxId: string): Promise<IMAPConfig | null> {
  const result = await pool.query<IMAPConfigRow>(
    `SELECT * FROM public.mailbox_imap_configs WHERE mailbox_id = $1`,
    [mailboxId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findIMAPConfigById(id: string, orgId: string): Promise<IMAPConfig | null> {
  const result = await pool.query<IMAPConfigRow>(
    `SELECT * FROM public.mailbox_imap_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function insertIMAPConfig(
  orgId: string,
  data: {
    mailboxId: string
    host: string
    port: number
    ssl: boolean
    authentication: 'password' | 'oauth2'
    username?: string
    encryptedPasswordReference?: string | null
  }
): Promise<IMAPConfig> {
  const result = await pool.query<IMAPConfigRow>(
    `INSERT INTO public.mailbox_imap_configs
      (mailbox_id, organization_id, host, port, ssl, authentication, username, encrypted_password_reference)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.mailboxId,
      orgId,
      data.host,
      data.port,
      data.ssl,
      data.authentication,
      data.username ?? '',
      data.encryptedPasswordReference ?? null,
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateIMAPConfig(
  id: string,
  orgId: string,
  data: {
    host?: string
    port?: number
    ssl?: boolean
    authentication?: 'password' | 'oauth2'
    username?: string
    encryptedPasswordReference?: string | null
    validationStatus?: ValidationStatus
  }
): Promise<IMAPConfig | null> {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (data.host !== undefined) {
    setClauses.push(`host = $${paramIndex++}`)
    values.push(data.host)
  }
  if (data.port !== undefined) {
    setClauses.push(`port = $${paramIndex++}`)
    values.push(data.port)
  }
  if (data.ssl !== undefined) {
    setClauses.push(`ssl = $${paramIndex++}`)
    values.push(data.ssl)
  }
  if (data.authentication !== undefined) {
    setClauses.push(`authentication = $${paramIndex++}`)
    values.push(data.authentication)
  }
  if (data.username !== undefined) {
    setClauses.push(`username = $${paramIndex++}`)
    values.push(data.username)
  }
  if (data.encryptedPasswordReference !== undefined) {
    setClauses.push(`encrypted_password_reference = $${paramIndex++}`)
    values.push(data.encryptedPasswordReference)
  }
  if (data.validationStatus !== undefined) {
    setClauses.push(`validation_status = $${paramIndex++}`)
    values.push(data.validationStatus)
    setClauses.push(`last_validated_at = NOW()`)
  }

  if (setClauses.length === 0) return findIMAPConfigById(id, orgId)

  setClauses.push('updated_at = NOW()')
  values.push(id, orgId)

  const result = await pool.query<IMAPConfigRow>(
    `UPDATE public.mailbox_imap_configs
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex++} AND organization_id = $${paramIndex}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function deleteIMAPConfig(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mailbox_imap_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export function toIMAPConfigResponse(config: IMAPConfig) {
  return {
    id: config.id,
    mailboxId: config.mailboxId,
    host: config.host,
    port: config.port,
    ssl: config.ssl,
    username: config.username,
    authentication: config.authentication,
    validationStatus: config.validationStatus,
    lastValidatedAt: config.lastValidatedAt,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}
