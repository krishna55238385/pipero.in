import pool from '@/lib/db'
import { decrypt, decryptAsync } from '@/lib/encryption'
import { handleOAuthSendFailure } from './mailbox-notification-service'
import { safeLogMessage } from '@/lib/credential-safety'

/**
 * Proactive OAuth token health probe (PRD §6.1.13 / §6.1.16).
 * Runs on a schedule so revoked tokens are detected within ~24h even without sends.
 */

const PROBE_LOCK = 7291099
const MAX_PER_RUN = 40
const RECHECK_HOURS = 12

async function tryDecrypt(ciphertext: string | null): Promise<string | null> {
  if (!ciphertext) return null
  try {
    return await decryptAsync(ciphertext)
  } catch {
    try {
      return decrypt(ciphertext)
    } catch {
      return null
    }
  }
}

async function probeGmail(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.ok) return { ok: true }
  const body = await res.text().catch(() => '')
  return { ok: false, error: `gmail_${res.status}:${body.slice(0, 120)}` }
}

async function probeOutlook(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.ok) return { ok: true }
  const body = await res.text().catch(() => '')
  return { ok: false, error: `outlook_${res.status}:${body.slice(0, 120)}` }
}

async function probeZoho(accessToken: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('https://mail.zoho.com/api/accounts', {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  })
  if (res.ok) return { ok: true }
  const body = await res.text().catch(() => '')
  return { ok: false, error: `zoho_${res.status}:${body.slice(0, 120)}` }
}

export async function runOAuthHealthProbeJob(): Promise<{
  checked: number
  healthy: number
  revoked: number
  skipped: number
}> {
  const lock = await pool.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [PROBE_LOCK])
  if (!lock.rows[0]?.ok) {
    return { checked: 0, healthy: 0, revoked: 0, skipped: 0 }
  }

  let checked = 0
  let healthy = 0
  let revoked = 0
  let skipped = 0

  try {
    const due = await pool.query<{
      mailbox_id: string
      organization_id: string
      email: string
      provider: string
      encrypted_access_token: string | null
      encrypted_refresh_token: string | null
    }>(
      `SELECT m.id AS mailbox_id, m.organization_id, m.email, m.provider,
              o.encrypted_access_token, o.encrypted_refresh_token
       FROM public.mail_mailboxes m
       INNER JOIN public.mailbox_oauth_configs o ON o.mailbox_id = m.id
       WHERE m.deleted_at IS NULL
         AND m.auth_type = 'oauth'
         AND m.mailbox_status IN ('connected', 'warming', 'pending', 'testing')
         AND (
           m.metadata->>'last_oauth_probe_at' IS NULL
           OR (m.metadata->>'last_oauth_probe_at')::timestamptz < NOW() - ($1 || ' hours')::interval
         )
       ORDER BY (m.metadata->>'last_oauth_probe_at') NULLS FIRST
       LIMIT $2`,
      [String(RECHECK_HOURS), MAX_PER_RUN]
    ).catch(async () => {
      // Fallback when mailbox_status enum differs
      return pool.query(
        `SELECT m.id AS mailbox_id, m.organization_id, m.email, m.provider,
                o.encrypted_access_token, o.encrypted_refresh_token
         FROM public.mail_mailboxes m
         INNER JOIN public.mailbox_oauth_configs o ON o.mailbox_id = m.id
         WHERE m.deleted_at IS NULL
           AND m.auth_type = 'oauth'
           AND COALESCE(m.mailbox_status::text, '') NOT IN ('reconnect_required', 'error', 'deleted', 'archived')
           AND (
             m.metadata->>'last_oauth_probe_at' IS NULL
             OR (m.metadata->>'last_oauth_probe_at')::timestamptz < NOW() - ($1 || ' hours')::interval
           )
         ORDER BY (m.metadata->>'last_oauth_probe_at') NULLS FIRST
         LIMIT $2`,
        [String(RECHECK_HOURS), MAX_PER_RUN]
      )
    })

    for (const row of due.rows) {
      checked++
      const access = await tryDecrypt(row.encrypted_access_token)
      if (!access) {
        skipped++
        await markProbed(row.mailbox_id, row.organization_id, 'no_access_token')
        continue
      }

      const provider = String(row.provider || '').toLowerCase()
      let result: { ok: boolean; error?: string }
      try {
        if (provider === 'outlook' || provider === 'microsoft') {
          result = await probeOutlook(access)
        } else if (provider === 'zoho') {
          result = await probeZoho(access)
        } else {
          result = await probeGmail(access)
        }
      } catch (err) {
        result = { ok: false, error: safeLogMessage(err) }
      }

      if (result.ok) {
        healthy++
        await markProbed(row.mailbox_id, row.organization_id, 'ok')
        continue
      }

      const handled = await handleOAuthSendFailure(
        row.organization_id,
        row.mailbox_id,
        row.email,
        result.error || 'oauth_probe_failed'
      )
      if (handled) revoked++
      else skipped++
      await markProbed(row.mailbox_id, row.organization_id, result.error || 'failed')
    }
  } finally {
    await pool.query('SELECT pg_advisory_unlock($1)', [PROBE_LOCK]).catch(() => {})
  }

  return { checked, healthy, revoked, skipped }
}

async function markProbed(mailboxId: string, orgId: string, result: string): Promise<void> {
  await pool
    .query(
      `UPDATE public.mail_mailboxes
       SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
         'last_oauth_probe_at', NOW()::text,
         'last_oauth_probe_result', $3
       ),
       updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [mailboxId, orgId, result.slice(0, 200)]
    )
    .catch(() => {})
}
