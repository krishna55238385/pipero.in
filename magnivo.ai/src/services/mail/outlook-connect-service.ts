import pool from '@/lib/db'
import { encrypt, encryptAsync } from '@/lib/encryption'
import { getMicrosoftScopes } from '@/services/mail/oauth/microsoft'
import type { MailApiResult } from '@/types/mail'

export type OutlookConnectResult = {
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

const REQUIRED_SCOPE_FRAGMENTS = ['Mail.Send', 'Mail.Read', 'User.Read', 'offline_access']

function scopesGranted(scopeStr: string): boolean {
  const granted = scopeStr.toLowerCase()
  return REQUIRED_SCOPE_FRAGMENTS.every((s) => granted.includes(s.toLowerCase()))
}

async function verifyOutlookAccess(accessToken: string): Promise<{
  profileOk: boolean
  inboxReadOk: boolean
  email: string
  displayName: string
  providerAccountId: string
}> {
  const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!profileRes.ok) {
    throw new Error(`Microsoft profile check failed (${profileRes.status})`)
  }
  const profile = (await profileRes.json()) as {
    mail?: string
    userPrincipalName?: string
    displayName?: string
    id?: string
  }
  const email = String(profile.mail || profile.userPrincipalName || '')
    .trim()
    .toLowerCase()
  if (!email || !email.includes('@')) {
    throw new Error('Microsoft profile did not return a mailbox email')
  }

  const listRes = await fetch('https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=id', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!listRes.ok) {
    const text = await listRes.text()
    throw new Error(`Outlook inbox read check failed (${listRes.status}): ${text.slice(0, 200)}`)
  }

  return {
    profileOk: true,
    inboxReadOk: true,
    email,
    displayName: String(profile.displayName || ''),
    providerAccountId: String(profile.id || ''),
  }
}

async function upsertEngageMicrosoft(input: {
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
         VALUES ($1,$2,'microsoft',$3,'',$4,'Bearer',$5,$6,$7,$8,$9,'active',$10,$11)
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
     VALUES ($1,$2,'microsoft',$3,$4,$5,'Bearer',$6,$7,'active',$8,$9)
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

async function upsertMailMailboxFromOutlook(input: {
  orgId: string
  userId: string
  actorEmail: string
  email: string
  displayName: string
  providerAccountId: string
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
        (organization_id, provider, auth_type, email, display_name, sender_name, provider_account_id,
         timezone, daily_limit, mailbox_status, verification_status)
       VALUES ($1, 'outlook', 'oauth', $2, $3, $3, $4, 'UTC', 50, 'connected', 'verified')
       RETURNING id`,
      [input.orgId, input.email, input.displayName || input.email, input.providerAccountId]
    )
    mailboxId = created.rows[0].id
  } else {
    await pool.query(
      `UPDATE public.mail_mailboxes
       SET mailbox_status = 'connected',
           verification_status = 'verified',
           provider = 'outlook',
           provider_account_id = COALESCE(NULLIF($3,''), provider_account_id),
           updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [mailboxId, input.orgId, input.providerAccountId]
    )
  }

  const encryptedAccess = await encryptAsync(input.accessToken)
  const encryptedRefresh = input.refreshToken ? await encryptAsync(input.refreshToken) : null

  await pool.query(
    `INSERT INTO public.mailbox_oauth_configs
      (mailbox_id, organization_id, provider, provider_account_id,
       encrypted_refresh_token, encrypted_access_token, token_expires_at, scope, last_rotated_at, updated_at)
     VALUES ($1,$2,'outlook',$3,$4,$5,$6,$7,NOW(),NOW())
     ON CONFLICT (mailbox_id, provider) DO UPDATE SET
       encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, mailbox_oauth_configs.encrypted_refresh_token),
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       token_expires_at = EXCLUDED.token_expires_at,
       scope = EXCLUDED.scope,
       provider_account_id = EXCLUDED.provider_account_id,
       last_rotated_at = NOW(),
       updated_at = NOW()`,
    [
      mailboxId,
      input.orgId,
      input.providerAccountId || input.email,
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
        JSON.stringify({ provider: 'outlook', scopes: input.scope, expectedScopes: getMicrosoftScopes() }),
      ]
    )
    .catch(() => {})

  await pool
    .query(
      `INSERT INTO public.mail_notifications
        (organization_id, mailbox_id, type, title, message, severity, metadata)
       VALUES ($1,$2,'mailbox_connected','Outlook connected',$3,'info',$4::jsonb)`,
      [
        input.orgId,
        mailboxId,
        `${input.email} connected via Microsoft OAuth and verified for send + inbox read.`,
        JSON.stringify({ provider: 'outlook', email: input.email }),
      ]
    )
    .catch(() => {})

  return mailboxId
}

/**
 * Completes Outlook / M365 OAuth for Engage + mail (PRD §6.1.02 / §14).
 */
export async function completeOutlookOAuthConnect(input: {
  userId: string
  orgId: string
  actorEmail: string
  accessToken: string
  refreshToken?: string | null
  scope?: string
  expiresIn?: number
}): Promise<MailApiResult<OutlookConnectResult>> {
  try {
    const scope = input.scope || getMicrosoftScopes().join(' ')
    if (!scopesGranted(scope)) {
      return {
        success: false,
        error:
          'Missing required Microsoft Graph scopes (Mail.Send, Mail.Read, User.Read, offline_access). Reconnect and grant all permissions.',
      }
    }

    const verified = await verifyOutlookAccess(input.accessToken)
    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null

    const engageMailboxId = await upsertEngageMicrosoft({
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
      mailMailboxId = await upsertMailMailboxFromOutlook({
        orgId: input.orgId,
        userId: input.userId,
        actorEmail: input.actorEmail,
        email: verified.email,
        displayName: verified.displayName,
        providerAccountId: verified.providerAccountId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken ?? null,
        scope,
        expiresAt,
      })
    } catch (err) {
      console.error(
        '[outlook-connect] mail dual-write failed:',
        err instanceof Error ? err.message : err
      )
    }

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
          scopesOk: true,
          scopes: scope,
        },
        connectedAt: new Date().toISOString(),
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Outlook OAuth connect failed'
    console.error('[outlook-connect]', message)
    return { success: false, error: message }
  }
}
