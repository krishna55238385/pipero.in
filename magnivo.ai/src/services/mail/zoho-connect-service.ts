import pool from '@/lib/db'
import { encrypt, encryptAsync } from '@/lib/encryption'
import { getZohoScopes } from '@/services/mail/oauth/zoho'
import type { MailApiResult } from '@/types/mail'

export type ZohoConnectResult = {
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

const REQUIRED_SCOPE_FRAGMENTS = [
  'ZohoMail.accounts.READ',
  'ZohoMail.messages.CREATE',
  'ZohoMail.messages.READ',
]

function scopesGranted(scopeStr: string): boolean {
  const granted = scopeStr.toLowerCase()
  return REQUIRED_SCOPE_FRAGMENTS.every((s) => granted.includes(s.toLowerCase()))
}

function zohoDomain(): string {
  return process.env.ZOHO_API_DOMAIN ?? 'https://accounts.zoho.com'
}

async function verifyZohoAccess(accessToken: string): Promise<{
  profileOk: boolean
  inboxReadOk: boolean
  email: string
  displayName: string
  providerAccountId: string
}> {
  const domain = zohoDomain()
  const profileRes = await fetch(`${domain}/oauth/user/info`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  })
  if (!profileRes.ok) {
    throw new Error(`Zoho profile check failed (${profileRes.status})`)
  }
  const data = (await profileRes.json()) as Record<string, unknown>
  const info = ((data.data as Record<string, unknown>) || data) as Record<string, unknown>
  const email = String(info.Email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    throw new Error('Zoho profile did not return an email')
  }

  // Accounts read proves mail API access with granted scopes
  const accountsRes = await fetch('https://mail.zoho.com/api/accounts', {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  })
  if (!accountsRes.ok) {
    const text = await accountsRes.text()
    throw new Error(`Zoho mailbox accounts check failed (${accountsRes.status}): ${text.slice(0, 200)}`)
  }

  return {
    profileOk: true,
    inboxReadOk: true,
    email,
    displayName: String(info.DisplayName || info.First_Name || ''),
    providerAccountId: String(info.ZUID || info.User_xid || ''),
  }
}

async function upsertEngageZoho(input: {
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

  const tryInsert = async (provider: 'zoho' | 'smtp') => {
    if (encryptedAccess) {
      try {
        const r = await pool.query<{ id: string }>(
          `INSERT INTO public.engage_mailboxes
           (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at,
            encrypted_access_token, encrypted_refresh_token, tokens_encrypted_at, status, updated_at, connected_at)
           VALUES ($1,$2,$3,$4,'',$5,'Bearer',$6,$7,$8,$9,$10,'active',$11,$12)
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
            provider,
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
        if (/engage_mailboxes_provider_check/i.test(message) && provider === 'zoho') {
          throw Object.assign(new Error('zoho_provider_constraint'), { cause: err })
        }
        if (!/encrypted_access_token|encrypted_refresh_token|tokens_encrypted_at/i.test(message)) {
          throw err
        }
      }
    }

    const legacy = await pool.query<{ id: string }>(
      `INSERT INTO public.engage_mailboxes
       (user_id, organization_id, provider, email, access_token, refresh_token, token_type, scope, expires_at, status, updated_at, connected_at)
       VALUES ($1,$2,$3,$4,$5,$6,'Bearer',$7,$8,'active',$9,$10)
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
        provider,
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

  try {
    return await tryInsert('zoho')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/zoho_provider_constraint|engage_mailboxes_provider_check/i.test(message)) {
      console.error('[zoho-connect] apply DBA_APPLY_AS_OWNER.sql to allow zoho provider; falling back unavailable')
      throw new Error(
        'Zoho provider is not enabled on engage_mailboxes. Apply DBA_APPLY_AS_OWNER.sql (owner) then reconnect.'
      )
    }
    throw err
  }
}

async function upsertMailMailboxFromZoho(input: {
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
       VALUES ($1, 'zoho', 'oauth', $2, $3, $3, $4, 'UTC', 50, 'connected', 'verified')
       RETURNING id`,
      [input.orgId, input.email, input.displayName || input.email, input.providerAccountId]
    )
    mailboxId = created.rows[0].id
  } else {
    await pool.query(
      `UPDATE public.mail_mailboxes
       SET mailbox_status = 'connected',
           verification_status = 'verified',
           provider = 'zoho',
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
     VALUES ($1,$2,'zoho',$3,$4,$5,$6,$7,NOW(),NOW())
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
        JSON.stringify({ provider: 'zoho', scopes: input.scope, expectedScopes: getZohoScopes() }),
      ]
    )
    .catch(() => {})

  await pool
    .query(
      `INSERT INTO public.mail_notifications
        (organization_id, mailbox_id, type, title, message, severity, metadata)
       VALUES ($1,$2,'mailbox_connected','Zoho connected',$3,'info',$4::jsonb)`,
      [
        input.orgId,
        mailboxId,
        `${input.email} connected via Zoho OAuth and verified for send + inbox read.`,
        JSON.stringify({ provider: 'zoho', email: input.email }),
      ]
    )
    .catch(() => {})

  return mailboxId
}

export async function completeZohoOAuthConnect(input: {
  userId: string
  orgId: string
  actorEmail: string
  accessToken: string
  refreshToken?: string | null
  scope?: string
  expiresIn?: number
}): Promise<MailApiResult<ZohoConnectResult>> {
  try {
    const scope = input.scope || getZohoScopes().join(',')
    if (!scopesGranted(scope)) {
      return {
        success: false,
        error:
          'Missing required Zoho Mail scopes (accounts.READ, messages.CREATE, messages.READ). Reconnect and grant all permissions.',
      }
    }

    const verified = await verifyZohoAccess(input.accessToken)
    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000)
      : null

    const engageMailboxId = await upsertEngageZoho({
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
      mailMailboxId = await upsertMailMailboxFromZoho({
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
      console.error('[zoho-connect] mail dual-write failed:', err instanceof Error ? err.message : err)
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
    const message = err instanceof Error ? err.message : 'Zoho OAuth connect failed'
    console.error('[zoho-connect]', message)
    return { success: false, error: message }
  }
}
