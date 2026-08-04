import pool from '@/lib/db'
import { encrypt, encryptAsync } from '@/lib/encryption'
import { getGoogleScopes } from '@/services/mail/oauth/google'
import type { MailApiResult } from '@/types/mail'

export type GmailConnectResult = {
  email: string
  engageMailboxId: string | null
  mailMailboxId: string | null
  status: 'connected'
  verification: {
    profileOk: boolean
    inboxReadOk: boolean
    scopesOk: boolean
    scopes: string
  }
  connectedAt: string
}

const REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
]

function scopesGranted(scopeStr: string): boolean {
  const granted = new Set(scopeStr.split(/[\s,]+/).filter(Boolean))
  return REQUIRED_SCOPES.every((s) => granted.has(s))
}

async function verifyGmailAccess(accessToken: string): Promise<{
  profileOk: boolean
  inboxReadOk: boolean
  email: string
  displayName: string
}> {
  const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!profileRes.ok) {
    throw new Error(`Gmail profile check failed (${profileRes.status})`)
  }
  const profile = (await profileRes.json()) as { email?: string; name?: string }
  const email = String(profile.email || '').trim().toLowerCase()
  if (!email) throw new Error('Google profile did not return an email')

  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (!listRes.ok) {
    const text = await listRes.text()
    throw new Error(`Gmail inbox read check failed (${listRes.status}): ${text.slice(0, 200)}`)
  }

  return {
    profileOk: true,
    inboxReadOk: true,
    email,
    displayName: String(profile.name || ''),
  }
}

async function upsertEngageGmail(input: {
  userId: string
  orgId: string
  email: string
  accessToken: string
  refreshToken: string | null
  scope: string
  expiresAt: Date | null
}): Promise<string> {
  const now = new Date().toISOString()
  let encryptedAccess: string | null = null
  let encryptedRefresh: string | null = null
  try {
    encryptedAccess = encrypt(input.accessToken)
    encryptedRefresh = input.refreshToken ? encrypt(input.refreshToken) : null
  } catch {
    encryptedAccess = null
  }

  if (encryptedAccess) {
    try {
      const r = await pool.query<{ id: string }>(
        `INSERT INTO public.engage_mailboxes
         (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at,
          encrypted_access_token, encrypted_refresh_token, tokens_encrypted_at, status, updated_at, connected_at)
         VALUES ($1,$2,'gmail',$3,'',$4,'Bearer',$5,$6,$7,$8,$9,'active',$10,$11)
         ON CONFLICT (user_id, provider, email) DO UPDATE SET
           encrypted_access_token = COALESCE(EXCLUDED.encrypted_access_token, engage_mailboxes.encrypted_access_token),
           encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, engage_mailboxes.encrypted_refresh_token),
           tokens_encrypted_at = COALESCE(EXCLUDED.tokens_encrypted_at, engage_mailboxes.tokens_encrypted_at),
           scope = EXCLUDED.scope,
           expires_at = EXCLUDED.expires_at,
           status = 'active',
           updated_at = EXCLUDED.updated_at,
           connected_at = EXCLUDED.connected_at
         RETURNING id`,
        [
          input.userId,
          input.orgId,
          input.email,
          encryptedRefresh ? '' : input.refreshToken,
          input.scope,
          input.expiresAt?.toISOString() ?? null,
          encryptedAccess,
          encryptedRefresh,
          now,
          now,
          now,
        ]
      )
      return r.rows[0].id
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!/encrypted_access_token|encrypted_refresh_token|tokens_encrypted_at/i.test(message)) {
        throw err
      }
    }
  }

  const legacy = await pool.query<{ id: string }>(
    `INSERT INTO public.engage_mailboxes
     (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at, status, updated_at, connected_at)
     VALUES ($1,$2,'gmail',$3,$4,$5,'Bearer',$6,$7,'active',$8,$9)
     ON CONFLICT (user_id, provider, email) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       scope = EXCLUDED.scope,
       expires_at = EXCLUDED.expires_at,
       status = 'active',
       updated_at = EXCLUDED.updated_at,
       connected_at = EXCLUDED.connected_at
     RETURNING id`,
    [
      input.userId,
      input.orgId,
      input.email,
      input.accessToken,
      input.refreshToken,
      input.scope,
      input.expiresAt?.toISOString() ?? null,
      now,
      now,
    ]
  )
  return legacy.rows[0].id
}

async function upsertMailMailboxFromGmail(input: {
  orgId: string
  userId: string
  actorEmail: string
  email: string
  displayName: string
  accessToken: string
  refreshToken: string | null
  scope: string
  expiresAt: Date | null
}): Promise<string> {
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM public.mail_mailboxes
     WHERE organization_id = $1 AND LOWER(email) = LOWER($2) AND deleted_at IS NULL
     LIMIT 1`,
    [input.orgId, input.email]
  )

  let mailboxId = existing.rows[0]?.id
  if (!mailboxId) {
    const created = await pool.query<{ id: string }>(
      `INSERT INTO public.mail_mailboxes
        (organization_id, provider, auth_type, email, display_name, sender_name,
         timezone, daily_limit, mailbox_status, verification_status)
       VALUES ($1, 'gmail', 'oauth', $2, $3, $3, 'UTC', 50, 'connected', 'verified')
       RETURNING id`,
      [input.orgId, input.email, input.displayName || input.email]
    )
    mailboxId = created.rows[0].id
  } else {
    await pool.query(
      `UPDATE public.mail_mailboxes
       SET mailbox_status = 'connected',
           verification_status = 'verified',
           display_name = CASE WHEN display_name = '' THEN $3 ELSE display_name END,
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [mailboxId, input.orgId, input.displayName || input.email]
    )
  }

  const encryptedAccess = await encryptAsync(input.accessToken)
  const encryptedRefresh = input.refreshToken ? await encryptAsync(input.refreshToken) : null

  await pool.query(
    `INSERT INTO public.mailbox_oauth_configs
      (mailbox_id, organization_id, provider, provider_account_id,
       encrypted_refresh_token, encrypted_access_token, token_expires_at, scope, last_rotated_at, updated_at)
     VALUES ($1,$2,'gmail',$3,$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT (mailbox_id, provider) DO UPDATE SET
       encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, mailbox_oauth_configs.encrypted_refresh_token),
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       token_expires_at = EXCLUDED.token_expires_at,
       scope = EXCLUDED.scope,
       last_rotated_at = NOW(),
       updated_at = NOW()`,
    [
      mailboxId,
      input.orgId,
      input.email,
      encryptedRefresh,
      encryptedAccess,
      input.expiresAt?.toISOString() ?? null,
      input.scope,
    ]
  )

  await pool
    .query(
      `INSERT INTO public.mailbox_audit_log
        (organization_id, mailbox_id, actor_user_id, actor_email, action, previous_status, new_status, metadata)
       VALUES ($1,$2,$3,$4,'oauth_connected',NULL,'connected',$5::jsonb)`,
      [
        input.orgId,
        mailboxId,
        input.userId,
        input.actorEmail,
        JSON.stringify({
          provider: 'gmail',
          scopes: input.scope,
          expectedScopes: getGoogleScopes(),
        }),
      ]
    )
    .catch(() => {})

  await pool
    .query(
      `INSERT INTO public.mail_notifications
        (organization_id, mailbox_id, type, title, message, severity, metadata)
       VALUES ($1,$2,'mailbox_connected','Gmail connected',$3,'info',$4::jsonb)`,
      [
        input.orgId,
        mailboxId,
        `${input.email} connected via Gmail OAuth and verified for send + inbox read.`,
        JSON.stringify({ provider: 'gmail', email: input.email }),
      ]
    )
    .catch(() => {})

  return mailboxId
}

/**
 * Completes Gmail OAuth for Engage + mail module (PRD §6.1.01 / §14).
 * No partial mailbox on failure — caller must not persist before this succeeds.
 */
export async function completeGmailOAuthConnect(input: {
  userId: string
  orgId: string
  actorEmail: string
  accessToken: string
  refreshToken?: string | null
  scope?: string
  expiresIn?: number
}): Promise<MailApiResult<GmailConnectResult>> {
  try {
    const scope = input.scope || getGoogleScopes().join(' ')
    const scopesOk = scopesGranted(scope)
    if (!scopesOk) {
      return {
        success: false,
        error:
          'Missing required Gmail scopes (gmail.readonly + gmail.send). Reconnect and grant all requested permissions.',
      }
    }

    const verified = await verifyGmailAccess(input.accessToken)
    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null

    const engageMailboxId = await upsertEngageGmail({
      userId: input.userId,
      orgId: input.orgId,
      email: verified.email,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken ?? null,
      scope,
      expiresAt,
    })

    let mailMailboxId: string | null = null
    try {
      mailMailboxId = await upsertMailMailboxFromGmail({
        orgId: input.orgId,
        userId: input.userId,
        actorEmail: input.actorEmail,
        email: verified.email,
        displayName: verified.displayName,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? null,
        scope,
        expiresAt,
      })
    } catch (err) {
      // Engage account remains usable even if mail_mailboxes dual-write fails
      console.error(
        '[gmail-connect] mail dual-write failed:',
        err instanceof Error ? err.message : err
      )
    }

    const connectedAt = new Date().toISOString()
    return {
      success: true,
      data: {
        email: verified.email,
        engageMailboxId,
        mailMailboxId,
        status: 'connected',
        verification: {
          profileOk: verified.profileOk,
          inboxReadOk: verified.inboxReadOk,
          scopesOk,
          scopes: scope,
        },
        connectedAt,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gmail OAuth connect failed'
    console.error('[gmail-connect]', message)
    return { success: false, error: message }
  }
}
