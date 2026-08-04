import type { WarmupNotificationEventType } from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'
import * as metricsService from './warmup-metrics-service'

type NotificationPayload = {
  configId: string
  organizationId: string
  eventType: WarmupNotificationEventType
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  metadata?: Record<string, unknown>
}

const EVENT_TYPE_MAP: Record<WarmupNotificationEventType, 'error' | 'health_warning' | 'health_critical' | 'graduated' | 'paused' | 'resumed' | 'milestone' | 'graduation_ready'> = {
  warmup_completed: 'milestone',
  warmup_graduated: 'graduated',
  warmup_paused: 'paused',
  health_degraded: 'health_warning',
  mailbox_disconnected: 'error',
  oauth_expired: 'error',
  dns_failure: 'error',
  execution_failed: 'error',
  scheduler_started: 'milestone',
  scheduler_stopped: 'milestone',
  recovery_triggered: 'error',
}

export async function sendNotification(payload: NotificationPayload): Promise<void> {
  const notificationType = EVENT_TYPE_MAP[payload.eventType]

  await warmupRepo.insertNotification({
    configId: payload.configId,
    organizationId: payload.organizationId,
    notificationType,
    severity: payload.severity,
    title: payload.title,
    message: payload.message,
    metadata: payload.metadata ?? {},
  })

  // Also surface in org mail_notifications for Engage Notifications center
  const pool = (await import('@/lib/db')).default
  await pool
    .query(
      `INSERT INTO public.mail_notifications
        (organization_id, type, title, message, severity, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        payload.organizationId,
        `warmup_${payload.eventType}`,
        payload.title,
        payload.message,
        payload.severity,
        JSON.stringify({ configId: payload.configId, ...(payload.metadata || {}) }),
      ]
    )
    .catch(() => {})

  if (payload.severity === 'critical') {
    try {
      const { sendSystemNotificationEmail } = await import('./system-notify-email')
      const settings = await pool.query<{ metadata: { notify_email?: string } | null }>(
        `SELECT metadata FROM public.mail_org_settings WHERE organization_id = $1`,
        [payload.organizationId]
      )
      const to =
        settings.rows[0]?.metadata?.notify_email?.trim() ||
        process.env.MAIL_SYSTEM_NOTIFY_FALLBACK_EMAIL ||
        ''
      if (to) {
        await sendSystemNotificationEmail({
          to,
          subject: `[Magnivo Warmup] ${payload.title}`,
          text: payload.message,
        })
      }
    } catch {
      // non-blocking
    }
  }
}

export async function notifyWarmupCompleted(
  configId: string,
  orgId: string,
  stats: { totalSends: number; successRate: number }
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'warmup_completed',
    title: 'Warmup Completed',
    message: `Warmup completed with ${stats.totalSends} sends. Success rate: ${stats.successRate}%`,
    severity: 'info',
    metadata: stats,
  })
}

export async function notifyWarmupGraduated(
  configId: string,
  orgId: string,
  healthScore: number
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'warmup_graduated',
    title: 'Warmup Graduated',
    message: `Warmup has graduated with health score: ${healthScore}`,
    severity: 'info',
    metadata: { healthScore },
  })
}

export async function notifyWarmupPaused(
  configId: string,
  orgId: string,
  reason: string
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'warmup_paused',
    title: 'Warmup Paused',
    message: `Warmup was automatically paused: ${reason}`,
    severity: 'warning',
    metadata: { reason },
  })
}

export async function notifyHealthDegraded(
  configId: string,
  orgId: string,
  currentHealth: string,
  healthScore: number
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'health_degraded',
    title: 'Health Degraded',
    message: `Warmup health degraded to ${currentHealth} (score: ${healthScore})`,
    severity: healthScore < 30 ? 'critical' : 'warning',
    metadata: { currentHealth, healthScore },
  })
}

export async function notifyOAuthExpired(
  configId: string,
  orgId: string
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'oauth_expired',
    title: 'OAuth Expired',
    message: 'OAuth credentials have expired. Warmup paused until re-authorized.',
    severity: 'critical',
  })
}

export async function notifyDnsFailure(
  configId: string,
  orgId: string
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'dns_failure',
    title: 'DNS Verification Failed',
    message: 'DNS verification failed. Warmup paused until DNS records are verified.',
    severity: 'critical',
  })
}

export async function notifyExecutionFailed(
  configId: string,
  orgId: string,
  error: string
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'execution_failed',
    title: 'Execution Failed',
    message: `Warmup execution failed: ${error}`,
    severity: 'warning',
    metadata: { error },
  })
}

export async function notifyMailboxDisconnected(
  configId: string,
  orgId: string
): Promise<void> {
  await sendNotification({
    configId,
    organizationId: orgId,
    eventType: 'mailbox_disconnected',
    title: 'Mailbox Disconnected',
    message: 'Mailbox is disconnected. Warmup paused until reconnected.',
    severity: 'critical',
  })
}

export async function recordAuditForAction(data: {
  organizationId: string
  action: string
  configId?: string
  jobId?: string
  executionId?: string
  previousStatus?: string
  newStatus?: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await metricsService.recordAuditLog(data)
}
