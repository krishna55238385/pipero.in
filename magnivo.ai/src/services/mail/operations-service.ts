import pool from '@/lib/db'
import crypto from 'crypto'
import type { MailApiResult } from '@/types/mail'

export type SendQueueStats = {
  pending: number
  processing: number
  deferred: number
  failed: number
  sent: number
  cancelled: number
}

export type SendQueueJob = {
  id: string
  status: string
  toEmail: string
  subject: string
  mailboxId: string
  campaignId: string | null
  attempts: number
  maxAttempts: number
  lastError: string | null
  scheduledFor: string
  nextAttemptAt: string
  createdAt: string
}

export async function getSendQueueStats(orgId: string): Promise<SendQueueStats> {
  const result = await pool.query<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int AS count
     FROM public.mail_send_jobs
     WHERE organization_id = $1
     GROUP BY status`,
    [orgId]
  )
  const stats: SendQueueStats = {
    pending: 0,
    processing: 0,
    deferred: 0,
    failed: 0,
    sent: 0,
    cancelled: 0,
  }
  for (const row of result.rows) {
    if (row.status in stats) {
      stats[row.status as keyof SendQueueStats] = row.count
    }
  }
  return stats
}

export async function listSendQueueJobs(
  orgId: string,
  opts?: { status?: string; limit?: number }
): Promise<SendQueueJob[]> {
  const limit = opts?.limit ?? 50
  const params: unknown[] = [orgId]
  let where = 'organization_id = $1'
  if (opts?.status && opts.status !== 'all') {
    params.push(opts.status)
    where += ` AND status = $${params.length}`
  }
  params.push(limit)
  const result = await pool.query(
    `SELECT id, status, to_email, subject, mailbox_id, campaign_id, attempts, max_attempts,
            last_error, scheduled_for, next_attempt_at, created_at
     FROM public.mail_send_jobs
     WHERE ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  )
  return result.rows.map((row) => ({
    id: row.id,
    status: row.status,
    toEmail: row.to_email,
    subject: row.subject,
    mailboxId: row.mailbox_id,
    campaignId: row.campaign_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error,
    scheduledFor: row.scheduled_for,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
  }))
}

export async function retryFailedSendJob(jobId: string, orgId: string): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `UPDATE public.mail_send_jobs
     SET status = 'pending', next_attempt_at = NOW(), last_error = NULL, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND status IN ('failed', 'deferred', 'cancelled')`,
    [jobId, orgId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export async function cancelSendJob(jobId: string, orgId: string): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `UPDATE public.mail_send_jobs
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND status IN ('pending', 'deferred', 'failed')`,
    [jobId, orgId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export type MailApiKey = {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export async function listApiKeys(orgId: string): Promise<MailApiKey[]> {
  const result = await pool.query(
    `SELECT id, name, key_prefix, scopes, last_used_at, revoked_at, created_at
     FROM public.mail_api_keys
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: row.scopes || [],
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  }))
}

export async function createApiKey(
  orgId: string,
  name: string,
  scopes: string[],
  actorUserId?: string
): Promise<MailApiResult<{ key: MailApiKey; plaintext: string }>> {
  const plaintext = `mgv_${crypto.randomBytes(24).toString('hex')}`
  const keyPrefix = plaintext.slice(0, 12)
  const keyHash = crypto.createHash('sha256').update(plaintext).digest('hex')
  try {
    const result = await pool.query(
      `INSERT INTO public.mail_api_keys
        (organization_id, name, key_prefix, key_hash, scopes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, key_prefix, scopes, last_used_at, revoked_at, created_at`,
      [orgId, name.trim(), keyPrefix, keyHash, scopes, actorUserId || null]
    )
    const row = result.rows[0]
    return {
      success: true,
      data: {
        plaintext,
        key: {
          id: row.id,
          name: row.name,
          keyPrefix: row.key_prefix,
          scopes: row.scopes || [],
          lastUsedAt: row.last_used_at,
          revokedAt: row.revoked_at,
          createdAt: row.created_at,
        },
      },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create API key' }
  }
}

export async function revokeApiKey(id: string, orgId: string): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `UPDATE public.mail_api_keys
     SET revoked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
    [id, orgId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export type MailWebhook = {
  id: string
  name: string
  url: string
  events: string[]
  isActive: boolean
  failureCount: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  createdAt: string
}

export async function listWebhooks(orgId: string): Promise<MailWebhook[]> {
  const result = await pool.query(
    `SELECT id, name, url, events, is_active, failure_count, last_success_at, last_failure_at, created_at
     FROM public.mail_webhooks
     WHERE organization_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    events: row.events || [],
    isActive: row.is_active,
    failureCount: row.failure_count,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    createdAt: row.created_at,
  }))
}

export async function createWebhook(
  orgId: string,
  input: { name: string; url: string; events?: string[] }
): Promise<MailApiResult<MailWebhook>> {
  const secret = crypto.randomBytes(16).toString('hex')
  try {
    const result = await pool.query(
      `INSERT INTO public.mail_webhooks (organization_id, name, url, secret, events)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, name, url, events, is_active, failure_count, last_success_at, last_failure_at, created_at`,
      [
        orgId,
        input.name.trim(),
        input.url.trim(),
        secret,
        input.events || ['send.completed', 'bounce', 'complaint', 'unsubscribe'],
      ]
    )
    const row = result.rows[0]
    return {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        url: row.url,
        events: row.events || [],
        isActive: row.is_active,
        failureCount: row.failure_count,
        lastSuccessAt: row.last_success_at,
        lastFailureAt: row.last_failure_at,
        createdAt: row.created_at,
      },
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create webhook' }
  }
}

export async function deleteWebhook(id: string, orgId: string): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `DELETE FROM public.mail_webhooks WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export async function toggleWebhook(id: string, orgId: string, isActive: boolean): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `UPDATE public.mail_webhooks SET is_active = $3, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId, isActive]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

export type WebhookLogEntry = {
  id: string
  webhookId: string
  eventType: string
  statusCode: number | null
  success: boolean
  errorMessage: string | null
  durationMs: number | null
  createdAt: string
}

export async function listWebhookLogs(orgId: string, limit = 50): Promise<WebhookLogEntry[]> {
  const result = await pool.query(
    `SELECT id, webhook_id, event_type, status_code, success, error_message, duration_ms, created_at
     FROM public.mail_webhook_logs
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [orgId, limit]
  )
  return result.rows.map((row) => ({
    id: row.id,
    webhookId: row.webhook_id,
    eventType: row.event_type,
    statusCode: row.status_code,
    success: row.success,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  }))
}

// ─── Queue Pause / Resume ──────────────────────────────────────

export type QueuePauseState = {
  paused: boolean
  pausedAt: string | null
  pausedBy: string | null
  resumeAt: string | null
}

export async function getQueuePauseState(orgId: string): Promise<QueuePauseState> {
  const result = await pool.query(
    `SELECT metadata->>'send_queue_paused' AS paused,
            metadata->>'send_queue_paused_at' AS paused_at,
            metadata->>'send_queue_paused_by' AS paused_by,
            metadata->>'send_queue_resume_at' AS resume_at
     FROM public.mail_org_settings
     WHERE organization_id = $1`,
    [orgId]
  )
  const row = result.rows[0]
  if (!row) return { paused: false, pausedAt: null, pausedBy: null, resumeAt: null }
  return {
    paused: row.paused === 'true',
    pausedAt: row.paused_at ?? null,
    pausedBy: row.paused_by ?? null,
    resumeAt: row.resume_at ?? null,
  }
}

export async function pauseSendQueue(orgId: string, actorUserId?: string, resumeAt?: string): Promise<MailApiResult<boolean>> {
  try {
    await pool.query(
      `UPDATE public.mail_org_settings SET
        metadata = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(COALESCE(metadata, '{}'::jsonb), '{send_queue_paused}', '"true"'),
              '{send_queue_paused_at}', to_jsonb(NOW()::text)
            ),
            '{send_queue_paused_by}', $2::jsonb
          ),
          '{send_queue_resume_at}', $3::jsonb
        ),
        updated_at = NOW()
      WHERE organization_id = $1`,
      [orgId, actorUserId ? JSON.stringify(actorUserId) : 'null', resumeAt ? JSON.stringify(resumeAt) : 'null']
    )
    await pool.query(
      `INSERT INTO public.mail_audit_events
        (organization_id, actor_user_id, entity_type, action, summary, metadata)
       VALUES ($1,$2,'send_queue','queue_paused',$3,'{"send_queue_paused":true}'::jsonb)`,
      [orgId, actorUserId ?? null, resumeAt ? `Send queue paused until ${resumeAt}` : 'Send queue paused']
    ).catch(() => {})
    return { success: true, data: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to pause send queue' }
  }
}

export async function resumeSendQueue(orgId: string, actorUserId?: string): Promise<MailApiResult<boolean>> {
  try {
    await pool.query(
      `UPDATE public.mail_org_settings SET
        metadata = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(COALESCE(metadata, '{}'::jsonb), '{send_queue_paused}', '"false"'),
              '{send_queue_paused_at}', 'null'
            ),
            '{send_queue_paused_by}', 'null'
          ),
          '{send_queue_resume_at}', 'null'
        ),
        updated_at = NOW()
      WHERE organization_id = $1`,
      [orgId]
    )
    await pool.query(
      `INSERT INTO public.mail_audit_events
        (organization_id, actor_user_id, entity_type, action, summary, metadata)
       VALUES ($1,$2,'send_queue','queue_resumed','Send queue resumed','{"send_queue_paused":false}'::jsonb)`,
      [orgId, actorUserId ?? null]
    ).catch(() => {})
    return { success: true, data: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to resume send queue' }
  }
}
