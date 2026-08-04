import pool from '@/lib/db'
import type { SMTPConfig, SMTPEncryption, SMTPAuthenticationType, ValidationStatus } from '@/types/mail'

type SMTPConfigRow = {
  id: string
  mailbox_id: string
  organization_id: string
  smtp_host: string
  smtp_port: number
  encryption: SMTPEncryption
  username: string
  encrypted_password_reference: string
  authentication_type: SMTPAuthenticationType
  validation_status: ValidationStatus
  last_validated_at: string | null
  created_at: string
  updated_at: string
}

function mapRow(row: SMTPConfigRow): SMTPConfig {
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    organizationId: row.organization_id,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    encryption: row.encryption,
    username: row.username,
    encryptedPasswordReference: row.encrypted_password_reference,
    authenticationType: row.authentication_type,
    validationStatus: row.validation_status,
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findSMTPConfigByMailboxId(mailboxId: string): Promise<SMTPConfig | null> {
  const result = await pool.query<SMTPConfigRow>(
    `SELECT * FROM public.mailbox_smtp_configs WHERE mailbox_id = $1`,
    [mailboxId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findSMTPConfigById(id: string, orgId: string): Promise<SMTPConfig | null> {
  const result = await pool.query<SMTPConfigRow>(
    `SELECT * FROM public.mailbox_smtp_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function insertSMTPConfig(
  orgId: string,
  data: {
    mailboxId: string
    smtpHost: string
    smtpPort: number
    encryption: SMTPEncryption
    username: string
    encryptedPasswordReference: string
    authenticationType: SMTPAuthenticationType
  }
): Promise<SMTPConfig> {
  const result = await pool.query<SMTPConfigRow>(
    `INSERT INTO public.mailbox_smtp_configs
      (mailbox_id, organization_id, smtp_host, smtp_port, encryption, username,
       encrypted_password_reference, authentication_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.mailboxId,
      orgId,
      data.smtpHost,
      data.smtpPort,
      data.encryption,
      data.username,
      data.encryptedPasswordReference,
      data.authenticationType,
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateSMTPConfig(
  id: string,
  orgId: string,
  data: {
    smtpHost?: string
    smtpPort?: number
    encryption?: SMTPEncryption
    username?: string
    encryptedPasswordReference?: string
    authenticationType?: SMTPAuthenticationType
    validationStatus?: ValidationStatus
  }
): Promise<SMTPConfig | null> {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (data.smtpHost !== undefined) {
    setClauses.push(`smtp_host = $${paramIndex++}`)
    values.push(data.smtpHost)
  }
  if (data.smtpPort !== undefined) {
    setClauses.push(`smtp_port = $${paramIndex++}`)
    values.push(data.smtpPort)
  }
  if (data.encryption !== undefined) {
    setClauses.push(`encryption = $${paramIndex++}`)
    values.push(data.encryption)
  }
  if (data.username !== undefined) {
    setClauses.push(`username = $${paramIndex++}`)
    values.push(data.username)
  }
  if (data.encryptedPasswordReference !== undefined) {
    setClauses.push(`encrypted_password_reference = $${paramIndex++}`)
    values.push(data.encryptedPasswordReference)
  }
  if (data.authenticationType !== undefined) {
    setClauses.push(`authentication_type = $${paramIndex++}`)
    values.push(data.authenticationType)
  }
  if (data.validationStatus !== undefined) {
    setClauses.push(`validation_status = $${paramIndex++}`)
    values.push(data.validationStatus)
    setClauses.push(`last_validated_at = NOW()`)
  }

  if (setClauses.length === 0) {
    return findSMTPConfigById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<SMTPConfigRow>(
    `UPDATE public.mailbox_smtp_configs SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function deleteSMTPConfig(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mailbox_smtp_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function deleteSMTPConfigByMailboxId(mailboxId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mailbox_smtp_configs WHERE mailbox_id = $1`,
    [mailboxId]
  )
  return (result.rowCount ?? 0) > 0
}
