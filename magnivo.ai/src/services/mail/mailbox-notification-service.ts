import pool from '@/lib/db'
import { sendSystemNotificationEmail } from './system-notify-email'

/**
 * In-app + email notification when a mailbox needs reconnect (PRD §6.1.15 / §14).
 */
export async function notifyMailboxReconnectRequired(input: {
  organizationId: string
  mailboxId: string
  email: string
  reason: string
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_notifications
      (organization_id, mailbox_id, type, title, message, severity, metadata)
     VALUES ($1,$2,'reconnect_required','Mailbox reconnect required',$3,'warning',$4::jsonb)`,
    [
      input.organizationId,
      input.mailboxId,
      `${input.email} needs reconnect: ${input.reason}`,
      JSON.stringify({ reason: input.reason, email: input.email }),
    ]
  ).catch(() => {})

  await pool.query(
    `UPDATE public.mail_mailboxes
     SET reconnect_notified_at = NOW(), mailbox_status = 'reconnect_required', updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [input.mailboxId, input.organizationId]
  ).catch(() => {})

  // Resolve who to email: org setting metadata.notify_email, else org owner emails
  const settings = await pool
    .query<{ metadata: { notify_email?: string } | null }>(
      `SELECT metadata FROM public.mail_org_settings WHERE organization_id = $1`,
      [input.organizationId]
    )
    .catch(() => ({ rows: [] as { metadata: { notify_email?: string } | null }[] }))

  let notifyEmail = settings.rows[0]?.metadata?.notify_email?.trim() || ''
  if (!notifyEmail) {
    notifyEmail = (process.env.MAIL_SYSTEM_NOTIFY_FALLBACK_EMAIL || '').trim()
  }

  if (!notifyEmail) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || ''
  const reconnectPath = `${appUrl.replace(/\/$/, '')}/engage/accounts`

  const subject = `[Magnivo] Reconnect required: ${input.email}`
  const text = [
    `Mailbox ${input.email} requires reconnect.`,
    ``,
    `Reason: ${input.reason}`,
    ``,
    `Open Accounts and reconnect OAuth or update SMTP credentials:`,
    reconnectPath || '/engage/accounts',
    ``,
    `Affected campaigns using this mailbox are paused for this mailbox only until reconnect succeeds.`,
  ].join('\n')

  const send = await sendSystemNotificationEmail({
    to: notifyEmail,
    subject,
    text,
  })

  if (!send.success) {
    console.error('[mail-notify] reconnect email not delivered:', send.error)
  }
}

/**
 * Detect revoked OAuth on send failure and flip status + notify.
 */
export async function handleOAuthSendFailure(
  organizationId: string,
  mailboxId: string,
  mailboxEmail: string,
  errorMessage: string
): Promise<boolean> {
  const revoked = /revoked|invalid_grant|unauthorized|401|403|expired.*token|token.*expired/i.test(
    errorMessage
  )
  if (!revoked) return false
  await notifyMailboxReconnectRequired({
    organizationId,
    mailboxId,
    email: mailboxEmail,
    reason: errorMessage.slice(0, 200),
  })

  // PRD §6.1.37 / §15: pause this mailbox's in-flight work only (not other pool members)
  await pool
    .query(
      `UPDATE public.mail_enrollments
       SET status = 'paused', pause_reason = 'mailbox_reconnect_required', updated_at = NOW()
       WHERE organization_id = $1 AND mailbox_id = $2 AND status = 'active'`,
      [organizationId, mailboxId]
    )
    .catch(() => {})

  await pool
    .query(
      `UPDATE public.mail_send_jobs
       SET status = 'deferred',
           next_attempt_at = NOW() + INTERVAL '1 hour',
           last_error = 'mailbox_reconnect_required',
           updated_at = NOW()
       WHERE organization_id = $1 AND mailbox_id = $2 AND status IN ('pending','processing')`,
      [organizationId, mailboxId]
    )
    .catch(() => {})

  await pool
    .query(
      `INSERT INTO public.mailbox_audit_log
        (organization_id, mailbox_id, actor_user_id, actor_email, action, previous_status, new_status, metadata)
       VALUES ($1,$2,'00000000-0000-0000-0000-000000000000','system@magnivo.ai','oauth_revoked','connected','reconnect_required',$3::jsonb)`,
      [
        organizationId,
        mailboxId,
        JSON.stringify({ reason: errorMessage.slice(0, 200), pausedEnrollments: true }),
      ]
    )
    .catch(() => {})

  // PRD §6.3.24: disconnect mid-warmup cancels; reconnect must restart from scratch
  try {
    const { cancelWarmupForMailbox } = await import('./warmup-service')
    await cancelWarmupForMailbox(mailboxId, organizationId, 'mailbox_reconnect_required')
  } catch {
    // optional if no active warmup
  }

  return true
}
