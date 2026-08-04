import { NextRequest, NextResponse } from 'next/server'
import { evaluateOrgDeliverabilityAlerts } from '@/services/mail/auto-pause-service'
import pool from '@/lib/db'

/**
 * Deliverability ops worker — bounce/complaint auto-pause + optional Postmaster/SNDS sync.
 * Secured by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.ENGAGE_WORKER_SECRET
  if (secret) {
    const auth = req.headers.get('authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (token !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { orgId?: string }
    const orgs = body.orgId
      ? [{ id: body.orgId }]
      : (
          await pool.query<{ id: string }>(
            `SELECT DISTINCT organization_id AS id FROM public.mail_mailboxes WHERE deleted_at IS NULL LIMIT 200`
          )
        ).rows

    let paused = 0
    const syncResults: unknown[] = []
    let oauthProbe: unknown = null

    try {
      const { runOAuthHealthProbeJob } = await import('@/services/mail/oauth-health-probe')
      oauthProbe = await runOAuthHealthProbeJob()
    } catch (err) {
      oauthProbe = { error: err instanceof Error ? err.message : 'oauth_probe_failed' }
    }

    for (const org of orgs) {
      paused += await evaluateOrgDeliverabilityAlerts(org.id)

    try {
      const postmaster = await import('@/services/mail/postmaster-service')
      const domains = await postmaster.listPostmasterDomains(org.id)
      for (const d of domains) {
        syncResults.push(await postmaster.syncPostmasterMetrics(d.id, org.id))
      }
    } catch {
      // optional
    }

    try {
      const snds = await import('@/services/mail/snds-service')
      const domains = await snds.listSndsDomains(org.id)
      for (const d of domains) {
        syncResults.push(await snds.syncSndsMetrics(d.id, org.id))
      }
    } catch {
      // optional
    }

      try {
        const { pollOrgSmtpMailboxes } = await import('@/services/mail/imap-inbox-poller')
        await pollOrgSmtpMailboxes(org.id)
      } catch {
        // optional
      }
    }

    let scheduledReports: unknown = null
    try {
      const { processDueScheduledReports } = await import('@/services/mail/scheduled-reports-service')
      scheduledReports = await processDueScheduledReports()
    } catch (err) {
      scheduledReports = { error: err instanceof Error ? err.message : 'scheduled_reports_failed' }
    }

    let webhookDeliveries: unknown = null
    try {
      const { processWebhookDeliveries } = await import('@/services/mail/webhook-delivery-service')
      webhookDeliveries = await processWebhookDeliveries()
    } catch (err) {
      webhookDeliveries = { error: err instanceof Error ? err.message : 'webhook_delivery_failed' }
    }

    return NextResponse.json({
      ok: true,
      orgs: orgs.length,
      paused,
      syncResults,
      oauthProbe,
      scheduledReports,
      webhookDeliveries,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worker failed'
    console.error('[mail/deliverability-worker]', message)
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
