import pool from '@/lib/db'
import nodemailer from 'nodemailer'
import { decryptAsync } from '@/lib/encryption'
import { createLogger } from '@/lib/logger'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import { isSendable } from '@/lib/mailbox-state-machine'
import { isSuppressed, createUnsubscribeToken, buildListUnsubscribeHeaders } from './suppression-service'
import { incrementMailboxUsage } from './analytics-service'
import { getOAuthService } from './oauth'
import { moveToDeadLetter } from './dead-letter-queue-service'
import { getQueuePauseState, resumeSendQueue } from './operations-service'
import type { MailApiResult, Mailbox } from '@/types/mail'

const log = createLogger('send-dispatcher')

const MAX_JOBS_PER_TICK = 40
const SOFT_BOUNCE_RETRY_BASE_MS = 60_000
const DEFER_HOURLY_CAP_MS = 15 * 60_000
const ZERO_WIDTH_CHARS = ['\u200B', '\u200C', '\u200D', '\u2060']

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.magnivo.ai'
}

function isWithinMailboxBusinessHours(mailbox: Mailbox): boolean {
  const meta = (mailbox.metadata || {}) as {
    businessHoursStart?: number
    businessHoursEnd?: number
    respectBusinessHours?: boolean
  }
  if (meta.respectBusinessHours === false) return true
  const start = meta.businessHoursStart ?? 9
  const end = meta.businessHoursEnd ?? 17
  const tz = mailbox.timezone || 'UTC'
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date())
    )
    if (end > start) return hour >= start && hour < end
    return hour >= start || hour < end
  } catch {
    const hour = new Date().getHours()
    return hour >= start && hour < end
  }
}

async function getHourlySendCount(mailboxId: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.mail_send_jobs
     WHERE mailbox_id = $1 AND status = 'sent' AND sent_at >= NOW() - INTERVAL '1 hour'`,
    [mailboxId]
  )
  return r.rows[0]?.c ?? 0
}

function hashSeed(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

async function getCampaignMetadata(campaignId: string | null): Promise<Record<string, unknown>> {
  if (!campaignId) return {}
  const result = await pool.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM public.campaigns WHERE id = $1`,
    [campaignId]
  )
  return result.rows[0]?.metadata ?? {}
}

function mailboxHourlyLimit(mailbox: Mailbox): number {
  if (typeof mailbox.hourlySendLimit === 'number' && mailbox.hourlySendLimit > 0) {
    return mailbox.hourlySendLimit
  }
  const meta = mailbox.metadata ?? {}
  if (typeof meta.hourlyLimit === 'number' && meta.hourlyLimit > 0) {
    return meta.hourlyLimit
  }
  if (typeof meta.hourly_send_limit === 'number' && meta.hourly_send_limit > 0) {
    return meta.hourly_send_limit
  }
  return Math.max(5, Math.floor(mailbox.dailyLimit / 8))
}

function applyCampaignVariation(
  subject: string,
  html: string,
  text: string,
  mailboxId: string,
  campaignMetadata: Record<string, unknown>
): { subject: string; html: string; text: string } {
  const wantsVariants =
    campaignMetadata.useVariants === true ||
    campaignMetadata.requestVariants === true ||
    Array.isArray(campaignMetadata.subjectVariants) ||
    Array.isArray(campaignMetadata.bodyVariants)

  if (!wantsVariants) {
    return varyContentForPool(mailboxId, subject, html, text)
  }

  const seed = hashSeed(mailboxId)
  const subjectVariants = Array.isArray(campaignMetadata.subjectVariants)
    ? (campaignMetadata.subjectVariants as string[]).filter(Boolean)
    : []
  const bodyVariants = Array.isArray(campaignMetadata.bodyVariants)
    ? (campaignMetadata.bodyVariants as string[]).filter(Boolean)
    : []

  let variedSubject = subject
  if (subjectVariants.length > 0) {
    variedSubject = subjectVariants[seed % subjectVariants.length] || subject
  } else {
    variedSubject = `${subject}${ZERO_WIDTH_CHARS[seed % ZERO_WIDTH_CHARS.length]}`
  }

  let variedHtml = html
  let variedText = text
  if (bodyVariants.length > 0) {
    const body = bodyVariants[seed % bodyVariants.length] || html
    variedHtml = body
    variedText = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  } else {
    const zw = ZERO_WIDTH_CHARS[(seed + 1) % ZERO_WIDTH_CHARS.length]
    variedHtml = html.includes('</p>') ? html.replace('</p>', `${zw}</p>`) : `${html}${zw}`
    variedText = text ? `${text}${zw}` : variedText
  }

  const salt = mailboxId.replace(/-/g, '').slice(0, 8)
  return {
    subject: variedSubject,
    html: `${variedHtml}<!-- ${salt} -->`,
    text: `${variedText}\n`,
  }
}

function varyContentForPool(
  mailboxId: string,
  subject: string,
  html: string,
  text: string
): { subject: string; html: string; text: string } {
  // Ensure two pool mailboxes never send byte-identical content in the same window
  const salt = mailboxId.replace(/-/g, '').slice(0, 8)
  const zw = '\u200B'
  return {
    subject: `${subject}${zw}`,
    html: `${html}<!-- ${salt} -->`,
    text: `${text}\n`,
  }
}

async function getPoolDailyUsage(poolId: string): Promise<number> {
  const result = await pool.query<{ used: number }>(
    `SELECT COALESCE(SUM(current_daily_usage), 0)::int AS used
     FROM public.mail_mailboxes
     WHERE pool_id = $1 AND deleted_at IS NULL`,
    [poolId]
  )
  return result.rows[0]?.used ?? 0
}

async function pickMailboxFromPool(orgId: string, poolId: string): Promise<Mailbox | null> {
  const members = await mailboxRepo.findMailboxesByOrg(orgId)
  const eligible = members.filter(
    (m) =>
      m.poolId === poolId &&
      isSendable(m.mailboxStatus) &&
      m.currentDailyUsage < m.dailyLimit &&
      !m.deletedAt
  )
  if (eligible.length === 0) return null
  eligible.sort((a, b) => a.currentDailyUsage - b.currentDailyUsage)
  return eligible[0]
}

async function sendViaMailbox(
  mailbox: Mailbox,
  message: {
    to: string
    subject: string
    html: string
    text: string
    headers: Record<string, string>
  }
): Promise<{ messageId?: string }> {
  if (mailbox.authType === 'oauth' && mailbox.oauthConfig) {
    const refresh = mailbox.oauthConfig.encryptedRefreshToken
      ? await decryptAsync(mailbox.oauthConfig.encryptedRefreshToken)
      : null
    if (!refresh) throw new Error('OAuth refresh token missing')
    const service = getOAuthService(mailbox.oauthConfig.provider)
    const tokens = await service.refreshToken(refresh)
    if (mailbox.oauthConfig.provider === 'gmail') {
      const { sendEmail } = await import('@/lib/gmail')
      const result = await sendEmail(tokens.accessToken, {
        to: message.to,
        subject: message.subject,
        bodyHtml: message.html,
        bodyText: message.text,
        headers: message.headers,
      })
      return { messageId: result?.id }
    }
    if (mailbox.oauthConfig.provider === 'outlook') {
      const { sendViaMicrosoftGraph } = await import('./oauth/send')
      return sendViaMicrosoftGraph(tokens.accessToken, message)
    }
    if (mailbox.oauthConfig.provider === 'zoho') {
      const { sendViaZohoMail } = await import('./oauth/send')
      return sendViaZohoMail(tokens.accessToken, mailbox.email, message)
    }
    throw new Error(`Unsupported OAuth provider: ${mailbox.oauthConfig.provider}`)
  }

  if (!mailbox.smtpConfig) throw new Error('No SMTP configuration for mailbox')
  const password = await decryptAsync(mailbox.smtpConfig.encryptedPasswordReference)
  const secure = mailbox.smtpConfig.encryption === 'ssl'
  const transport = nodemailer.createTransport({
    host: mailbox.smtpConfig.smtpHost,
    port: mailbox.smtpConfig.smtpPort,
    secure,
    auth: { user: mailbox.smtpConfig.username, pass: password },
  })
  try {
    const info = await transport.sendMail({
      from: `"${mailbox.senderName || mailbox.displayName || mailbox.email}" <${mailbox.email}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      headers: message.headers,
    })
    return { messageId: info.messageId }
  } finally {
    transport.close()
  }
}

export async function enqueueSendJob(input: {
  organizationId: string
  enrollmentId?: string
  campaignId?: string
  mailboxId: string
  leadId?: string
  toEmail: string
  subject: string
  bodyHtml: string
  bodyText?: string
  scheduledFor?: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  if (await isSuppressed(input.organizationId, input.toEmail)) {
    throw new Error('Recipient is suppressed')
  }
  const result = await pool.query<{ id: string }>(
    `INSERT INTO public.mail_send_jobs
      (organization_id, enrollment_id, campaign_id, mailbox_id, lead_id, to_email,
       subject, body_html, body_text, scheduled_for, next_attempt_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10,$11::jsonb)
     RETURNING id`,
    [
      input.organizationId,
      input.enrollmentId ?? null,
      input.campaignId ?? null,
      input.mailboxId,
      input.leadId ?? null,
      input.toEmail.trim().toLowerCase(),
      input.subject,
      input.bodyHtml,
      input.bodyText ?? '',
      input.scheduledFor ?? new Date().toISOString(),
      JSON.stringify(input.metadata ?? {}),
    ]
  )
  return result.rows[0].id
}

export async function processSendQueue(orgId?: string): Promise<{ processed: number; sent: number; failed: number }> {
  const params: unknown[] = []
  let orgFilter = ''
  if (orgId) {
    params.push(orgId)
    orgFilter = `AND organization_id = $${params.length}`
  }
  params.push(MAX_JOBS_PER_TICK)

  const jobs = await pool.query(
    `SELECT * FROM public.mail_send_jobs
     WHERE status IN ('pending', 'deferred')
       AND next_attempt_at <= NOW()
       AND scheduled_for <= NOW()
       ${orgFilter}
     ORDER BY next_attempt_at ASC
     LIMIT $${params.length}
     FOR UPDATE SKIP LOCKED`,
    params
  )

  if (orgId) {
    const pauseState = await getQueuePauseState(orgId)
    if (pauseState.paused) {
      if (pauseState.resumeAt && new Date(pauseState.resumeAt) <= new Date()) {
        await resumeSendQueue(orgId)
      } else {
        log.info('Send queue is paused', { orgId })
        return { processed: 0, sent: 0, failed: 0 }
      }
    }
  }

  let sent = 0
  let failed = 0

  for (const job of jobs.rows) {
    await pool.query(
      `UPDATE public.mail_send_jobs SET status = 'processing', attempts = attempts + 1, updated_at = NOW() WHERE id = $1`,
      [job.id]
    )

    try {
      if (await isSuppressed(job.organization_id, job.to_email)) {
        await pool.query(
          `UPDATE public.mail_send_jobs SET status = 'cancelled', last_error = 'suppressed', updated_at = NOW() WHERE id = $1`,
          [job.id]
        )
        continue
      }

      // Per-workspace hourly rate limiting
      const workspaceResult = await pool.query(
        `SELECT COUNT(*)::int AS c FROM public.mail_send_jobs
         WHERE organization_id = $1 AND status = 'sent' AND sent_at >= NOW() - INTERVAL '1 hour'`,
        [job.organization_id]
      )
      const workspaceHourlyCount = workspaceResult.rows[0]?.c ?? 0
      const workspaceHourlyLimit = 5000
      if (workspaceHourlyCount >= workspaceHourlyLimit) {
        await pool.query(
          `UPDATE public.mail_send_jobs
           SET status = 'deferred', next_attempt_at = NOW() + INTERVAL '15 minutes',
               last_error = 'workspace_cap', updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        )
        continue
      }

      let mailbox = await mailboxRepo.findMailboxWithConfigs(job.mailbox_id, job.organization_id)
      if (!mailbox || !isSendable(mailbox.mailboxStatus)) {
        throw new Error('Mailbox not sendable')
      }
      if (mailbox.currentDailyUsage >= mailbox.dailyLimit) {
        if (mailbox.poolId) {
          const alternate = await pickMailboxFromPool(job.organization_id, mailbox.poolId)
          if (alternate && alternate.id !== mailbox.id) {
            // PRD §6.4.33 — redistribute to pool headroom
            await pool.query(
              `UPDATE public.mail_send_jobs
               SET mailbox_id = $2,
                   last_error = 'redistributed_daily_cap',
                   updated_at = NOW()
               WHERE id = $1`,
              [job.id, alternate.id]
            )
            mailbox = await mailboxRepo.findMailboxWithConfigs(alternate.id, job.organization_id)
            if (!mailbox) throw new Error('Alternate mailbox unavailable')
          } else {
            await pool.query(
              `UPDATE public.mail_send_jobs
               SET status = 'deferred', next_attempt_at = date_trunc('day', NOW() + INTERVAL '1 day'),
                   last_error = 'daily_cap', updated_at = NOW()
               WHERE id = $1`,
              [job.id]
            )
            continue
          }
        } else {
          await pool.query(
            `UPDATE public.mail_send_jobs
             SET status = 'deferred', next_attempt_at = date_trunc('day', NOW() + INTERVAL '1 day'),
                 last_error = 'daily_cap', updated_at = NOW()
             WHERE id = $1`,
            [job.id]
          )
          continue
        }
      }

      if (!isWithinMailboxBusinessHours(mailbox)) {
        await pool.query(
          `UPDATE public.mail_send_jobs
           SET status = 'deferred', next_attempt_at = NOW() + INTERVAL '30 minutes',
               last_error = 'outside_business_hours', updated_at = NOW()
           WHERE id = $1`,
          [job.id]
        )
        continue
      }

      const hourlyLimit = mailboxHourlyLimit(mailbox)
      const hourlyCount = await getHourlySendCount(mailbox.id)
      if (hourlyCount >= hourlyLimit) {
        if (mailbox.poolId) {
          const alternate = await pickMailboxFromPool(job.organization_id, mailbox.poolId)
          if (alternate && alternate.id !== mailbox.id) {
            await pool.query(
              `UPDATE public.mail_send_jobs
               SET mailbox_id = $2, last_error = 'redistributed_hourly_cap', updated_at = NOW()
               WHERE id = $1`,
              [job.id, alternate.id]
            )
            mailbox = await mailboxRepo.findMailboxWithConfigs(alternate.id, job.organization_id)
            if (!mailbox) throw new Error('Alternate mailbox unavailable')
          } else {
            await pool.query(
              `UPDATE public.mail_send_jobs
               SET status = 'deferred', next_attempt_at = NOW() + ($2 || ' milliseconds')::interval,
                   last_error = 'hourly_cap', updated_at = NOW()
               WHERE id = $1`,
              [job.id, String(DEFER_HOURLY_CAP_MS)]
            )
            continue
          }
        } else {
          await pool.query(
            `UPDATE public.mail_send_jobs
             SET status = 'deferred', next_attempt_at = NOW() + ($2 || ' milliseconds')::interval,
                 last_error = 'hourly_cap', updated_at = NOW()
             WHERE id = $1`,
            [job.id, String(DEFER_HOURLY_CAP_MS)]
          )
          continue
        }
      }

      // Per-domain rate limiting
      const domain = job.to_email.split('@')[1]?.toLowerCase()
      if (domain) {
        const domainResult = await pool.query(
          `SELECT COUNT(*)::int AS c FROM public.mail_send_jobs
           WHERE organization_id = $1 AND to_email LIKE $2 AND status = 'sent' AND sent_at >= NOW() - INTERVAL '1 hour'`,
          [job.organization_id, `%@${domain}`]
        )
        const domainHourlyCount = domainResult.rows[0]?.c ?? 0
        const domainHourlyLimit = 50
        if (domainHourlyCount >= domainHourlyLimit) {
          await pool.query(
            `UPDATE public.mail_send_jobs
             SET status = 'deferred', next_attempt_at = NOW() + INTERVAL '30 minutes',
                 last_error = 'domain_cap', updated_at = NOW()
             WHERE id = $1`,
            [job.id]
          )
          continue
        }
      }

      if (mailbox.poolId) {
        const poolRow = await pool.query<{ daily_pool_limit: number }>(
          `SELECT daily_pool_limit FROM public.mailbox_pools WHERE id = $1 AND organization_id = $2`,
          [mailbox.poolId, job.organization_id]
        )
        const limit = poolRow.rows[0]?.daily_pool_limit ?? 500
        const used = await getPoolDailyUsage(mailbox.poolId)
        if (used >= limit) {
          await pool.query(
            `UPDATE public.mail_send_jobs
             SET status = 'deferred', next_attempt_at = date_trunc('day', NOW() + INTERVAL '1 day'),
                 last_error = 'pool_cap', updated_at = NOW()
             WHERE id = $1`,
            [job.id]
          )
          continue
        }
      }

      // GDPR consent check
      const consentResult = await pool.query(
        `SELECT 1 FROM public.mail_consent_records
         WHERE organization_id = $1 AND LOWER(email) = LOWER($2)
           AND consent_type = 'outreach' AND status = 'granted'
         LIMIT 1`,
        [job.organization_id, job.to_email]
      )
      if (consentResult.rows.length === 0) {
        const settingsResult = await pool.query(
          `SELECT metadata->>'requireConsent' AS require_consent FROM public.mail_org_settings WHERE organization_id = $1`,
          [job.organization_id]
        )
        if (settingsResult.rows[0]?.require_consent === 'true') {
          await pool.query(
            `UPDATE public.mail_send_jobs
             SET status = 'cancelled', last_error = 'consent_required', updated_at = NOW()
             WHERE id = $1`,
            [job.id]
          )
          continue
        }
      }

      const unsubToken = await createUnsubscribeToken(job.organization_id, job.to_email, {
        leadId: job.lead_id ?? undefined,
        campaignId: job.campaign_id ?? undefined,
      })
      const unsubUrl = `${appBaseUrl()}/api/track/unsubscribe?token=${encodeURIComponent(unsubToken)}`
      const headers = buildListUnsubscribeHeaders(unsubUrl)

      let footer = ''
      const settings = await pool.query<{ physical_address: string; company_name: string }>(
        `SELECT physical_address, company_name FROM public.mail_org_settings WHERE organization_id = $1`,
        [job.organization_id]
      ).catch(() => ({ rows: [] as { physical_address: string; company_name: string }[] }))
      const addr = (settings.rows[0]?.physical_address || '').trim()
      const company = (settings.rows[0]?.company_name || '').trim()
      if (addr || company) {
        footer = `<p style="font-size:11px;color:#94a3b8;margin-top:24px">${company ? `${company}<br/>` : ''}${addr}</p>`
      }

      const campaignMetadata = await getCampaignMetadata(job.campaign_id ?? null)
      const varied = applyCampaignVariation(
        String(job.subject ?? ''),
        `${job.body_html}${footer}<br/><br/><p style="font-size:12px;color:#64748b"><a href="${unsubUrl}">Unsubscribe</a></p>`,
        `${job.body_text || ''}\n\n${company}\n${addr}\nUnsubscribe: ${unsubUrl}`,
        mailbox.id,
        campaignMetadata
      )

      const result = await sendViaMailbox(mailbox, {
        to: job.to_email,
        subject: varied.subject,
        html: varied.html,
        text: varied.text,
        headers,
      })

      await pool.query(
        `UPDATE public.mail_send_jobs
         SET status = 'sent', sent_at = NOW(), provider_message_id = $2, updated_at = NOW()
         WHERE id = $1`,
        [job.id, result.messageId ?? null]
      )
      await pool.query(
        `UPDATE public.mail_mailboxes
         SET current_daily_usage = current_daily_usage + 1, consecutive_send_failures = 0, updated_at = NOW()
         WHERE id = $1`,
        [mailbox.id]
      )
      await incrementMailboxUsage(job.organization_id, mailbox.id, { sends: 1 })
      sent++
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Send failed'
      try {
        const { handleOAuthSendFailure } = await import('./mailbox-notification-service')
        const mb = await mailboxRepo.findMailboxById(job.mailbox_id, job.organization_id)
        if (mb) {
          await handleOAuthSendFailure(job.organization_id, mb.id, mb.email, message)
        }
      } catch {
        // non-fatal
      }
      const attempts = Number(job.attempts) + 1
      const maxAttempts = Number(job.max_attempts) || 5
      const isPermanent = /5\d\d|invalid recipient|mailbox unavailable|user unknown/i.test(message)
      if (isPermanent || attempts >= maxAttempts) {
        if (isPermanent && job.to_email) {
          const { suppressEmail } = await import('./suppression-service')
          await suppressEmail(job.organization_id, job.to_email, 'hard_bounce', 'send', job.lead_id, job.campaign_id)
          await incrementMailboxUsage(job.organization_id, job.mailbox_id, { bounces: 1 })
        }
        const dlqResult = await moveToDeadLetter(job.id, isPermanent ? 'permanent_failure' : 'max_attempts_exceeded')
        if (!dlqResult.success) {
          log.error('Failed to move job to dead-letter queue', { jobId: job.id, error: dlqResult.error })
          await pool.query(
            `UPDATE public.mail_send_jobs
             SET status = 'dead_letter', last_error = $2, updated_at = NOW() WHERE id = $1`,
            [job.id, message]
          )
        }
        log.warn('Send job failed permanently', { jobId: job.id, reason: message, isPermanent, attempts })
        failed++
      } else {
        const backoff = SOFT_BOUNCE_RETRY_BASE_MS * Math.pow(2, attempts - 1)
        await pool.query(
          `UPDATE public.mail_send_jobs
           SET status = 'deferred', last_error = $2,
               next_attempt_at = NOW() + ($3 || ' milliseconds')::interval, updated_at = NOW()
           WHERE id = $1`,
          [job.id, message, String(backoff)]
        )
      }

      await pool.query(
        `UPDATE public.mail_mailboxes
         SET consecutive_send_failures = consecutive_send_failures + 1, updated_at = NOW()
         WHERE id = $1
         RETURNING consecutive_send_failures, email`,
        [job.mailbox_id]
      ).then(async (r) => {
        const failures = Number(r.rows[0]?.consecutive_send_failures ?? 0)
        const mailboxEmail = String(r.rows[0]?.email ?? '')
        if (failures >= 5) {
          await pool.query(
            `UPDATE public.mail_mailboxes SET mailbox_status = 'error', updated_at = NOW() WHERE id = $1`,
            [job.mailbox_id]
          )
          await pool.query(
            `INSERT INTO public.mail_notifications
              (organization_id, mailbox_id, type, title, message, severity)
             VALUES ($1,$2,'send_failures','Mailbox auto-paused','Consecutive send failures exceeded threshold','critical')`,
            [job.organization_id, job.mailbox_id]
          )
          const { notifyMailboxReconnectRequired } = await import('./mailbox-notification-service')
          await notifyMailboxReconnectRequired({
            organizationId: job.organization_id,
            mailboxId: job.mailbox_id,
            email: mailboxEmail || 'unknown',
            reason: `Auto-paused after ${failures} consecutive SMTP/send failures`,
          }).catch(() => {})
        }
      })
    }
  }

  return { processed: jobs.rows.length, sent, failed }
}

export async function assertCampaignMailboxesWarm(
  orgId: string,
  poolId: string | null
): Promise<MailApiResult<true>> {
  if (!poolId) return { success: false, error: 'Campaign must be attached to a mailbox pool' }
  const mailboxes = await mailboxRepo.findMailboxesByOrg(orgId)
  const members = mailboxes.filter((m) => m.poolId === poolId && !m.deletedAt)
  if (members.length === 0) return { success: false, error: 'Mailbox pool has no members' }

  const notWarm = members.filter(
    (m) =>
      m.warmupStatus !== 'completed' ||
      m.mailboxStatus === 'pending_dns' ||
      m.mailboxStatus === 'pending_warmup' ||
      m.mailboxStatus === 'warming' ||
      m.mailboxStatus === 'at_risk' ||
      m.mailboxStatus === 'reconnect_required' ||
      m.mailboxStatus === 'error'
  )
  if (notWarm.length > 0) {
    return {
      success: false,
      error: `Cannot launch: ${notWarm.length} mailbox(es) are not Warm (graduated). Warmup must complete before live sending.`,
    }
  }
  return { success: true, data: true }
}
