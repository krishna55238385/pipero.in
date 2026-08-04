import pool from '@/lib/db'
import type { ScheduledReport, ScheduledReportCadence, ScheduledReportType } from '@/types/mail'

type ScheduledReportRow = {
  id: string
  organization_id: string
  name: string
  report_type: string
  cadence: string
  recipients: string[]
  format: string
  is_active: boolean
  next_run_at: string
  last_run_at: string | null
  last_status: string | null
  last_error: string | null
  created_by: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapRow(row: ScheduledReportRow): ScheduledReport {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    reportType: row.report_type as ScheduledReportType,
    cadence: row.cadence as ScheduledReportCadence,
    recipients: row.recipients ?? [],
    format: 'csv',
    isActive: row.is_active,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdBy: row.created_by,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function nextRunAfter(from: Date, cadence: ScheduledReportCadence): Date {
  const d = new Date(from)
  if (cadence === 'daily') d.setUTCDate(d.getUTCDate() + 1)
  else if (cadence === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
  else d.setUTCMonth(d.getUTCMonth() + 1)
  return d
}

export async function listScheduledReports(orgId: string): Promise<ScheduledReport[]> {
  const result = await pool
    .query<ScheduledReportRow>(
      `SELECT * FROM public.mail_scheduled_reports
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [orgId]
    )
    .catch(() => ({ rows: [] as ScheduledReportRow[] }))
  return result.rows.map(mapRow)
}

export async function createScheduledReport(input: {
  organizationId: string
  name: string
  reportType: ScheduledReportType
  cadence: ScheduledReportCadence
  recipients: string[]
  createdBy?: string | null
}): Promise<ScheduledReport> {
  const next = nextRunAfter(new Date(), input.cadence)
  const result = await pool.query<ScheduledReportRow>(
    `INSERT INTO public.mail_scheduled_reports
      (organization_id, name, report_type, cadence, recipients, next_run_at, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.organizationId,
      input.name.trim(),
      input.reportType,
      input.cadence,
      input.recipients,
      next.toISOString(),
      input.createdBy ?? null,
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateScheduledReport(
  id: string,
  orgId: string,
  patch: Partial<{
    name: string
    cadence: ScheduledReportCadence
    recipients: string[]
    isActive: boolean
    reportType: ScheduledReportType
  }>
): Promise<ScheduledReport | null> {
  const existing = await pool.query<ScheduledReportRow>(
    `SELECT * FROM public.mail_scheduled_reports WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  if (!existing.rows[0]) return null

  const row = existing.rows[0]
  const cadence = patch.cadence ?? (row.cadence as ScheduledReportCadence)
  const next =
    patch.cadence && patch.cadence !== row.cadence
      ? nextRunAfter(new Date(), cadence)
      : new Date(row.next_run_at)

  const result = await pool.query<ScheduledReportRow>(
    `UPDATE public.mail_scheduled_reports SET
       name = COALESCE($3, name),
       report_type = COALESCE($4, report_type),
       cadence = COALESCE($5, cadence),
       recipients = COALESCE($6, recipients),
       is_active = COALESCE($7, is_active),
       next_run_at = $8,
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [
      id,
      orgId,
      patch.name ?? null,
      patch.reportType ?? null,
      patch.cadence ?? null,
      patch.recipients ?? null,
      patch.isActive ?? null,
      next.toISOString(),
    ]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function deleteScheduledReport(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_scheduled_reports WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function findDueScheduledReports(limit = 50): Promise<ScheduledReport[]> {
  const result = await pool
    .query<ScheduledReportRow>(
      `SELECT * FROM public.mail_scheduled_reports
       WHERE is_active = TRUE AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT $1`,
      [limit]
    )
    .catch(() => ({ rows: [] as ScheduledReportRow[] }))
  return result.rows.map(mapRow)
}

async function buildReportCsv(
  orgId: string,
  reportType: ScheduledReportType
): Promise<{ csv: string; filename: string }> {
  const date = new Date().toISOString().slice(0, 10)
  if (reportType === 'analytics_raw') {
    const { exportRawAnalyticsEventsCsv } = await import('@/services/mail/analytics-service')
    return { csv: await exportRawAnalyticsEventsCsv(orgId, 30), filename: `raw-events-${date}.csv` }
  }
  if (reportType === 'placement') {
    const { getPlacementAnalytics } = await import('@/services/mail/analytics-service')
    const rows = await getPlacementAnalytics(orgId, 30)
    const lines = ['date,inbox,spam,unknown,inbox_rate,spam_rate']
    for (const r of rows) {
      lines.push(`${r.date},${r.inbox},${r.spam},${r.unknown},${r.inboxRate},${r.spamRate}`)
    }
    return { csv: lines.join('\n'), filename: `placement-${date}.csv` }
  }
  if (reportType === 'usage') {
    const { getOrgUsageSummary } = await import('@/services/mail/analytics-service')
    const u = await getOrgUsageSummary(orgId)
    const csv = [
      'metric,value',
      `sends,${u.sends}`,
      `opens,${u.opens}`,
      `clicks,${u.clicks}`,
      `replies,${u.replies}`,
      `bounces,${u.bounces}`,
      `unsubscribes,${u.unsubscribes}`,
      `warmup_sends,${u.warmupSends}`,
    ].join('\n')
    return { csv, filename: `usage-${date}.csv` }
  }

  const svc = await import('@/services/mail/engage-product-service')
  const rows =
    reportType === 'campaigns'
      ? await svc.buildCampaignPerformanceReport(orgId)
      : reportType === 'mailboxes'
        ? await svc.buildMailboxHealthReport(orgId)
        : await svc.buildLeadHygieneReport(orgId)
  return { csv: svc.rowsToCsv(rows), filename: `${reportType}-${date}.csv` }
}

async function notifyRecipients(
  orgId: string,
  report: ScheduledReport,
  csv: string,
  filename: string
): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_notifications
      (organization_id, type, title, message, severity, metadata)
     VALUES ($1, 'scheduled_report', $2, $3, 'info', $4::jsonb)`,
    [
      orgId,
      `Scheduled report: ${report.name}`,
      `Report "${report.name}" (${report.reportType}/${report.cadence}) is ready (${filename}, ${csv.split('\n').length - 1} rows).`,
      JSON.stringify({
        reportId: report.id,
        filename,
        recipients: report.recipients,
        preview: csv.slice(0, 500),
      }),
    ]
  ).catch(() => {})

  if (report.recipients.length === 0) return

  try {
    const { sendSystemNotificationEmail } = await import('@/services/mail/system-notify-email')
    for (const to of report.recipients.slice(0, 10)) {
      await sendSystemNotificationEmail({
        to,
        subject: `[Magnivo] ${report.name} (${report.cadence})`,
        text: `Your scheduled ${report.reportType} report is ready.\n\nFilename: ${filename}\nRows: ${csv.split('\n').length - 1}\n\nOpen Engage → Reports / Notifications to download the latest export.`,
      }).catch(() => {})
    }
  } catch {
    // system notify optional
  }
}

export async function processDueScheduledReports(): Promise<{ processed: number; failed: number }> {
  const due = await findDueScheduledReports(50)
  let processed = 0
  let failed = 0

  for (const report of due) {
    try {
      const { csv, filename } = await buildReportCsv(report.organizationId, report.reportType)
      await notifyRecipients(report.organizationId, report, csv, filename)
      const next = nextRunAfter(new Date(), report.cadence)
      await pool.query(
        `UPDATE public.mail_scheduled_reports SET
           last_run_at = NOW(),
           last_status = 'success',
           last_error = NULL,
           next_run_at = $3,
           updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [report.id, report.organizationId, next.toISOString()]
      )
      processed++
    } catch (err) {
      failed++
      const next = nextRunAfter(new Date(), report.cadence)
      await pool
        .query(
          `UPDATE public.mail_scheduled_reports SET
             last_run_at = NOW(),
             last_status = 'failed',
             last_error = $3,
             next_run_at = $4,
             updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [
            report.id,
            report.organizationId,
            err instanceof Error ? err.message.slice(0, 500) : 'failed',
            next.toISOString(),
          ]
        )
        .catch(() => {})
    }
  }

  return { processed, failed }
}
