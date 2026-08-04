import nodemailer from 'nodemailer'

/**
 * System-notification email (reconnect alerts, ops). Uses MAIL_SYSTEM_SMTP_* env.
 * Never logs credentials.
 */
export async function sendSystemNotificationEmail(input: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<{ success: boolean; error?: string }> {
  const host = process.env.MAIL_SYSTEM_SMTP_HOST
  const user = process.env.MAIL_SYSTEM_SMTP_USER
  const pass = process.env.MAIL_SYSTEM_SMTP_PASS
  const from = process.env.MAIL_SYSTEM_FROM || user

  if (!host || !user || !pass || !from) {
    return {
      success: false,
      error: 'MAIL_SYSTEM_SMTP_HOST/USER/PASS (and optional FROM) must be configured to send notification email',
    }
  }

  const port = Number(process.env.MAIL_SYSTEM_SMTP_PORT || 587)
  const secure = process.env.MAIL_SYSTEM_SMTP_SECURE === 'true' || port === 465

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 10000,
  })

  try {
    await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html || `<pre style="font-family:sans-serif;white-space:pre-wrap">${input.text}</pre>`,
    })
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'system_email_failed'
    console.error('[system-notify] send failed:', message)
    return { success: false, error: message }
  } finally {
    transport.close()
  }
}
