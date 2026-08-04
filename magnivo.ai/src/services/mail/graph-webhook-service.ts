import crypto from 'crypto'
import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'
import { ingestInboundMessage } from './inbox-service'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const CHANGE_TYPE = 'created'
const RESOURCE_TEMPLATE = "users/{email}/mailFolders('Inbox')/messages"
const EXPIRATION_MINUTES = 4230
const NOTIFICATION_URL_PATH = '/api/webhooks/microsoft/graph'

function getClientState(): string {
  return crypto.randomBytes(32).toString('hex')
}

function getNotificationUrl(): string {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL
  if (!base) return ''
  return `${base}${NOTIFICATION_URL_PATH}`
}

async function graphFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      ...options,
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = body?.error?.message || body?.error || `Graph API error (${res.status})`
      return { ok: false, status: res.status, error: msg }
    }
    return { ok: true, status: res.status, data: body as T }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : 'Network error' }
  }
}

function subscriptionRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    mailboxId: String(row.mailbox_id),
    email: String(row.email),
    subscriptionId: String(row.subscription_id),
    clientState: String(row.client_state),
    resource: String(row.resource),
    expirationDateTime: String(row.expiration_date_time),
    status: String(row.status),
    lastNotificationAt: row.last_notification_at ? String(row.last_notification_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export async function subscribeToGraphNotifications(
  orgId: string,
  mailboxId: string,
  accessToken: string,
  email: string
): Promise<MailApiResult<{ subscriptionId: string; expirationDateTime: string }>> {
  try {
    const existing = await pool.query(
      `SELECT * FROM public.mail_graph_subscriptions
       WHERE organization_id = $1 AND mailbox_id = $2`,
      [orgId, mailboxId]
    )
    if (existing.rows[0]) {
      const sub = existing.rows[0]
      return {
        success: true,
        data: {
          subscriptionId: String(sub.subscription_id),
          expirationDateTime: String(sub.expiration_date_time),
        },
      }
    }

    const clientState = getClientState()
    const resource = RESOURCE_TEMPLATE.replace('{email}', encodeURIComponent(email))
    const expirationDateTime = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString()
    const notificationUrl = getNotificationUrl()

    if (!notificationUrl) {
      return { success: false, error: 'APP_URL is not configured' }
    }

    const body = {
      changeType: CHANGE_TYPE,
      notificationUrl,
      resource,
      expirationDateTime,
      clientState,
    }

    const result = await graphFetch<{
      id: string
      expirationDateTime: string
      clientState: string
    }>('/subscriptions', accessToken, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    if (!result.ok || !result.data) {
      return { success: false, error: result.error || 'Failed to create subscription' }
    }

    await pool.query(
      `INSERT INTO public.mail_graph_subscriptions
       (organization_id, mailbox_id, email, subscription_id, client_state, resource, expiration_date_time, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
      [
        orgId,
        mailboxId,
        email,
        result.data.id,
        clientState,
        resource,
        result.data.expirationDateTime,
      ]
    )

    return {
      success: true,
      data: {
        subscriptionId: result.data.id,
        expirationDateTime: result.data.expirationDateTime,
      },
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'subscribeToGraphNotifications failed',
    }
  }
}

export async function renewGraphSubscription(
  subscriptionId: string,
  accessToken: string
): Promise<MailApiResult<{ expirationDateTime: string }>> {
  try {
    const expirationDateTime = new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString()

    const result = await graphFetch<{ expirationDateTime: string }>(
      `/subscriptions/${subscriptionId}`,
      accessToken,
      {
        method: 'PATCH',
        body: JSON.stringify({ expirationDateTime }),
      }
    )

    if (!result.ok) {
      return { success: false, error: result.error || 'Failed to renew subscription' }
    }

    const newExpiration = result.data?.expirationDateTime || expirationDateTime

    await pool.query(
      `UPDATE public.mail_graph_subscriptions
       SET expiration_date_time = $2, status = 'active', updated_at = NOW()
       WHERE subscription_id = $1`,
      [subscriptionId, newExpiration]
    )

    return { success: true, data: { expirationDateTime: newExpiration } }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'renewGraphSubscription failed',
    }
  }
}

export async function processGraphNotification(
  validationToken?: string,
  notifications?: unknown[]
): Promise<{ validationToken?: string } | { ok: boolean }> {
  if (validationToken) {
    return { validationToken }
  }

  if (!notifications || notifications.length === 0) {
    return { ok: true }
  }

  for (const raw of notifications) {
    const notif = raw as Record<string, unknown>
    const subscriptionId = String(notif.subscriptionId ?? '')
    const clientState = String(notif.clientState ?? '')
    const resource = String(notif.resource ?? '')

    const row = await pool.query(
      `SELECT * FROM public.mail_graph_subscriptions WHERE subscription_id = $1 LIMIT 1`,
      [subscriptionId]
    )
    if (!row.rows[0]) {
      console.warn(`[graph-webhook] unknown subscription: ${subscriptionId}`)
      continue
    }

    const sub = row.rows[0]
    if (String(sub.client_state) !== clientState) {
      console.error(`[graph-webhook] clientState mismatch for subscription ${subscriptionId}`)
      continue
    }

    await pool.query(
      `UPDATE public.mail_graph_subscriptions
       SET last_notification_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [sub.id]
    )

    const mailboxId = String(sub.mailbox_id)
    const organizationId = String(sub.organization_id)
    const email = String(sub.email)

    const oauthRow = await pool.query(
      `SELECT encrypted_access_token FROM public.mailbox_oauth_configs
       WHERE mailbox_id = $1 AND provider = 'outlook' AND organization_id = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [mailboxId, organizationId]
    )

    if (!oauthRow.rows[0]) {
      console.warn(`[graph-webhook] no oauth config for mailbox ${mailboxId}`)
      continue
    }

    let accessToken: string
    try {
      const { decrypt } = await import('@/lib/encryption')
      accessToken = decrypt(String(oauthRow.rows[0].encrypted_access_token))
    } catch {
      console.error(`[graph-webhook] failed to decrypt access token for mailbox ${mailboxId}`)
      continue
    }

    const messageId = resource.split('/').pop() || ''
    if (!messageId) {
      console.warn(`[graph-webhook] no messageId in resource: ${resource}`)
      continue
    }

    const msgResult = await graphFetch<Record<string, unknown>>(
      `/me/messages/${messageId}`,
      accessToken
    )

    if (!msgResult.ok || !msgResult.data) {
      await pool.query(
        `UPDATE public.mail_graph_subscriptions
         SET last_error = $2, updated_at = NOW()
         WHERE id = $1`,
        [sub.id, msgResult.error || 'Failed to fetch message']
      )
      continue
    }

    const msg = msgResult.data
    try {
      await ingestInboundMessage({
        organizationId,
        mailboxId,
        fromEmail: String((msg.from as any)?.emailAddress?.address || ''),
        toEmails: [(msg.toRecipients as any[])?.[0]?.emailAddress?.address || ''],
        subject: String(msg.subject || ''),
        bodyText: String((msg.body as any)?.content || ''),
        bodyHtml: (msg.body as any)?.contentType === 'html' ? String((msg.body as any)?.content) : undefined,
        providerThreadId: String(msg.conversationId || ''),
        providerMessageId: String(msg.id || ''),
      })
    } catch (ingestErr) {
      console.error(`[graph-webhook] ingest failed for message ${messageId}:`, ingestErr)
    }
  }

  return { ok: true }
}

export async function listGraphSubscriptions(orgId: string): Promise<unknown[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_graph_subscriptions
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(subscriptionRow)
}

export async function deleteGraphSubscription(
  subscriptionId: string,
  accessToken: string
): Promise<MailApiResult<boolean>> {
  try {
    const result = await graphFetch<undefined>(
      `/subscriptions/${subscriptionId}`,
      accessToken,
      { method: 'DELETE' }
    )

    if (!result.ok && result.status !== 404) {
      return { success: false, error: result.error || 'Failed to delete subscription' }
    }

    await pool.query(
      `UPDATE public.mail_graph_subscriptions
       SET status = 'revoked', updated_at = NOW()
       WHERE subscription_id = $1`,
      [subscriptionId]
    )

    return { success: true, data: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'deleteGraphSubscription failed',
    }
  }
}

export async function renewAllExpiringSubscriptions(): Promise<{ renewed: number; failed: number }> {
  const cutoff = new Date(Date.now() + 30 * 60 * 1000).toISOString()

  const expiring = await pool.query(
    `SELECT * FROM public.mail_graph_subscriptions
     WHERE status = 'active' AND expiration_date_time <= $1`,
    [cutoff]
  )

  let renewed = 0
  let failed = 0

  for (const sub of expiring.rows) {
    const mailboxId = String(sub.mailbox_id)
    const organizationId = String(sub.organization_id)

    const oauthRow = await pool.query(
      `SELECT encrypted_access_token, encrypted_refresh_token, provider_account_id
       FROM public.mailbox_oauth_configs
       WHERE mailbox_id = $1 AND provider = 'outlook' AND organization_id = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [mailboxId, organizationId]
    )

    if (!oauthRow.rows[0]) {
      failed++
      await pool.query(
        `UPDATE public.mail_graph_subscriptions
         SET last_error = 'No OAuth config', updated_at = NOW()
         WHERE id = $1`,
        [sub.id]
      )
      continue
    }

    try {
      const { decrypt } = await import('@/lib/encryption')
      let accessToken = decrypt(String(oauthRow.rows[0].encrypted_access_token))
      const refreshToken = oauthRow.rows[0].encrypted_refresh_token
        ? decrypt(String(oauthRow.rows[0].encrypted_refresh_token))
        : null

      const checkResult = await graphFetch<{ id: string }>(
        `/subscriptions/${sub.subscription_id}`,
        accessToken
      )

      if (!checkResult.ok && refreshToken) {
        const { getOAuthService } = await import('@/services/mail/oauth')
        const service = getOAuthService('outlook')
        const tokens = await service.refreshToken(refreshToken)
        accessToken = tokens.accessToken

        const result = await graphFetch<{ expirationDateTime: string }>(
          `/subscriptions/${sub.subscription_id}`,
          accessToken,
          {
            method: 'PATCH',
            body: JSON.stringify({
              expirationDateTime: new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString(),
            }),
          }
        )

        if (!result.ok) {
          failed++
          await pool.query(
            `UPDATE public.mail_graph_subscriptions
             SET last_error = $2, updated_at = NOW()
             WHERE id = $1`,
            [sub.id, result.error || 'Renew failed']
          )
          continue
        }

        const newExpiration = result.data?.expirationDateTime
        await pool.query(
          `UPDATE public.mail_graph_subscriptions
           SET expiration_date_time = $2, status = 'active', updated_at = NOW()
           WHERE id = $1`,
          [sub.id, newExpiration || new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString()]
        )
        renewed++
      } else if (checkResult.ok) {
        const result = await graphFetch<{ expirationDateTime: string }>(
          `/subscriptions/${sub.subscription_id}`,
          accessToken,
          {
            method: 'PATCH',
            body: JSON.stringify({
              expirationDateTime: new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString(),
            }),
          }
        )

        if (!result.ok) {
          failed++
          await pool.query(
            `UPDATE public.mail_graph_subscriptions
             SET last_error = $2, updated_at = NOW()
             WHERE id = $1`,
            [sub.id, result.error || 'Renew failed']
          )
          continue
        }

        const newExpiration = result.data?.expirationDateTime
        await pool.query(
          `UPDATE public.mail_graph_subscriptions
           SET expiration_date_time = $2, status = 'active', updated_at = NOW()
           WHERE id = $1`,
          [sub.id, newExpiration || new Date(Date.now() + EXPIRATION_MINUTES * 60 * 1000).toISOString()]
        )
        renewed++
      } else {
        failed++
        await pool.query(
          `UPDATE public.mail_graph_subscriptions
           SET status = 'revoked', last_error = $2, updated_at = NOW()
           WHERE id = $1`,
          [sub.id, checkResult.error || 'Subscription not found']
        )
      }
    } catch (err) {
      failed++
      await pool.query(
        `UPDATE public.mail_graph_subscriptions
         SET last_error = $2, updated_at = NOW()
         WHERE id = $1`,
        [sub.id, err instanceof Error ? err.message : 'Renew error']
      )
    }
  }

  return { renewed, failed }
}
