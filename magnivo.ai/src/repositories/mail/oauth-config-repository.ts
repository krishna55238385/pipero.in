import pool from '@/lib/db'
import type { OAuthConfig, OAuthProvider } from '@/types/mail'

type OAuthConfigRow = {
  id: string
  mailbox_id: string
  organization_id: string
  provider: OAuthProvider
  provider_account_id: string
  encrypted_refresh_token: string | null
  encrypted_access_token: string | null
  token_expires_at: string | null
  scope: string
  last_rotated_at: string | null
  created_at: string
  updated_at: string
}

function mapRow(row: OAuthConfigRow): OAuthConfig {
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    organizationId: row.organization_id,
    provider: row.provider,
    providerAccountId: row.provider_account_id,
    encryptedRefreshToken: row.encrypted_refresh_token,
    encryptedAccessToken: row.encrypted_access_token,
    tokenExpiresAt: row.token_expires_at,
    scope: row.scope,
    lastRotatedAt: row.last_rotated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findOAuthConfigByMailboxId(mailboxId: string): Promise<OAuthConfig | null> {
  const result = await pool.query<OAuthConfigRow>(
    `SELECT * FROM public.mailbox_oauth_configs WHERE mailbox_id = $1`,
    [mailboxId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findOAuthConfigById(id: string, orgId: string): Promise<OAuthConfig | null> {
  const result = await pool.query<OAuthConfigRow>(
    `SELECT * FROM public.mailbox_oauth_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findOAuthConfigByMailboxAndProvider(
  mailboxId: string,
  provider: OAuthProvider
): Promise<OAuthConfig | null> {
  const result = await pool.query<OAuthConfigRow>(
    `SELECT * FROM public.mailbox_oauth_configs WHERE mailbox_id = $1 AND provider = $2`,
    [mailboxId, provider]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function insertOAuthConfig(
  orgId: string,
  data: {
    mailboxId: string
    provider: OAuthProvider
    providerAccountId: string
    encryptedRefreshToken: string | null
    encryptedAccessToken: string | null
    tokenExpiresAt: string | null
    scope: string
  }
): Promise<OAuthConfig> {
  const result = await pool.query<OAuthConfigRow>(
    `INSERT INTO public.mailbox_oauth_configs
      (mailbox_id, organization_id, provider, provider_account_id,
       encrypted_refresh_token, encrypted_access_token, token_expires_at, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.mailboxId,
      orgId,
      data.provider,
      data.providerAccountId,
      data.encryptedRefreshToken,
      data.encryptedAccessToken,
      data.tokenExpiresAt,
      data.scope,
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateOAuthConfig(
  id: string,
  orgId: string,
  data: {
    encryptedRefreshToken?: string | null
    encryptedAccessToken?: string | null
    tokenExpiresAt?: string | null
    scope?: string
  }
): Promise<OAuthConfig | null> {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (data.encryptedRefreshToken !== undefined) {
    setClauses.push(`encrypted_refresh_token = $${paramIndex++}`)
    values.push(data.encryptedRefreshToken)
  }
  if (data.encryptedAccessToken !== undefined) {
    setClauses.push(`encrypted_access_token = $${paramIndex++}`)
    values.push(data.encryptedAccessToken)
  }
  if (data.tokenExpiresAt !== undefined) {
    setClauses.push(`token_expires_at = $${paramIndex++}`)
    values.push(data.tokenExpiresAt)
  }
  if (data.scope !== undefined) {
    setClauses.push(`scope = $${paramIndex++}`)
    values.push(data.scope)
  }

  if (setClauses.length === 0) {
    return findOAuthConfigById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<OAuthConfigRow>(
    `UPDATE public.mailbox_oauth_configs SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function deleteOAuthConfig(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mailbox_oauth_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function deleteOAuthConfigByMailboxId(mailboxId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mailbox_oauth_configs WHERE mailbox_id = $1`,
    [mailboxId]
  )
  return (result.rowCount ?? 0) > 0
}
