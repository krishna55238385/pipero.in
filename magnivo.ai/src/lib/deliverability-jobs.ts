import { runMonitoringChecks } from '@/services/mail/monitoring-service'
import { processPendingJobs, processRetriableJobs, cleanupOldJobs } from '@/services/mail/monitoring-scheduler-service'
import { checkAllBlacklistsForDomain } from '@/services/mail/blacklist-service'
import { calculateInternalReputation } from '@/services/mail/reputation-service'
import { processRetries as processBounceRetries } from '@/services/mail/bounce-service'
import { syncPostmasterMetrics } from '@/services/mail/postmaster-service'
import { syncSndsMetrics } from '@/services/mail/snds-service'
import * as domainRepo from '@/repositories/mail/domain-repository'
import pool from '@/lib/db'

const JOB_LOCK_KEY = 7291034

async function acquireLock(lockKey: number): Promise<boolean> {
  try {
    const result = await pool.query('SELECT pg_try_advisory_lock($1)', [lockKey])
    return result.rows[0]?.pg_try_advisory_lock ?? false
  } catch {
    return false
  }
}

async function releaseLock(lockKey: number): Promise<void> {
  try {
    await pool.query('SELECT pg_advisory_unlock($1)', [lockKey])
  } catch {
    // ignore
  }
}

export async function runDnsVerificationJob(): Promise<{ checked: number; succeeded: number; failed: number }> {
  if (!await acquireLock(JOB_LOCK_KEY)) {
    return { checked: 0, succeeded: 0, failed: 0 }
  }

  try {
    return await runMonitoringChecks()
  } finally {
    await releaseLock(JOB_LOCK_KEY)
  }
}

export async function runBlacklistCheckJob(): Promise<{ checked: number; listed: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 1)) {
    return { checked: 0, listed: 0 }
  }

  try {
    const domains = await domainRepo.findDomainsDueForCheck()
    let checked = 0
    let listed = 0

    const BATCH_SIZE = 5
    for (let i = 0; i < domains.length; i += BATCH_SIZE) {
      const batch = domains.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (domain) => {
          const result = await checkAllBlacklistsForDomain(domain.organizationId, domain.id)
          const hasListed = result.results.some(r => r.status === 'listed')
          return { domainId: domain.id, listed: hasListed }
        })
      )
      for (const result of results) {
        checked++
        if (result.status === 'fulfilled' && result.value.listed) {
          listed++
        }
      }
    }

    return { checked, listed }
  } finally {
    await releaseLock(JOB_LOCK_KEY + 1)
  }
}

export async function runReputationCheckJob(): Promise<{ checked: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 2)) {
    return { checked: 0 }
  }

  try {
    const orgsResult = await pool.query(
      `SELECT DISTINCT organization_id FROM public.mail_deliverability_domains`
    )

    let checked = 0
    for (const org of orgsResult.rows) {
      const domains = await domainRepo.findDomainsByOrg(org.organization_id)
      for (const domain of domains) {
        try {
          const bounceResult = await pool.query(
            `SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE suppressed = TRUE)::int AS suppressed
             FROM public.mail_bounce_records
             WHERE organization_id = $1 AND domain_id = $2
               AND created_at >= NOW() - INTERVAL '30 days'`,
            [org.organization_id, domain.id]
          )
          const bounceTotal = bounceResult.rows[0]?.total ?? 0
          const bounceSuppressed = bounceResult.rows[0]?.suppressed ?? 0
          const bounceRate = bounceTotal > 0 ? bounceSuppressed / bounceTotal : 0

          const complaintResult = await pool.query(
            `SELECT COUNT(*)::int AS count
             FROM public.mail_complaint_records
             WHERE organization_id = $1 AND domain_id = $2
               AND created_at >= NOW() - INTERVAL '30 days'`,
            [org.organization_id, domain.id]
          )
          const complaintCount = complaintResult.rows[0]?.count ?? 0
          const complaintRate = complaintCount > 0 ? Math.min(complaintCount / 1000, 1) : 0

          const openResult = await pool.query(
            `SELECT
               COUNT(DISTINCT pe.recipient_email)::int AS unique_opens,
               COUNT(DISTINCT t.recipient_email)::int AS total_sent
             FROM public.mail_tracking_tokens t
             LEFT JOIN public.mail_tracking_pixel_events pe ON pe.tracking_token_id = t.id
             WHERE t.organization_id = $1
               AND t.created_at >= NOW() - INTERVAL '30 days'`,
            [org.organization_id]
          )
          const uniqueOpens = openResult.rows[0]?.unique_opens ?? 0
          const totalSent = openResult.rows[0]?.total_sent ?? 0
          const openRate = totalSent > 0 ? uniqueOpens / totalSent : 0.25

          await calculateInternalReputation(
            org.organization_id,
            domain.id,
            bounceRate,
            complaintRate,
            openRate
          )
          checked++
        } catch {
          // continue with next domain
        }
      }
    }

    return { checked }
  } finally {
    await releaseLock(JOB_LOCK_KEY + 2)
  }
}

export async function runBounceRetryJob(): Promise<{ retried: number; suppressed: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 3)) {
    return { retried: 0, suppressed: 0 }
  }

  try {
    const orgsResult = await pool.query(
      `SELECT DISTINCT organization_id FROM public.mail_bounce_records
       WHERE suppressed = FALSE AND bounce_type = 'soft'`
    )

    let totalRetried = 0
    let totalSuppressed = 0

    for (const org of orgsResult.rows) {
      const result = await processBounceRetries(org.organization_id)
      totalRetried += result.retried
      totalSuppressed += result.suppressed
    }

    return { retried: totalRetried, suppressed: totalSuppressed }
  } finally {
    await releaseLock(JOB_LOCK_KEY + 3)
  }
}

export async function runCleanupJob(): Promise<{ jobsDeleted: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 4)) {
    return { jobsDeleted: 0 }
  }

  try {
    const { deleted } = await cleanupOldJobs(30)
    return { jobsDeleted: deleted }
  } finally {
    await releaseLock(JOB_LOCK_KEY + 4)
  }
}

export async function processPendingMonitoringJobs(): Promise<{ processed: number; succeeded: number; failed: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 5)) {
    return { processed: 0, succeeded: 0, failed: 0 }
  }

  try {
    const retriable = await processRetriableJobs()
    if (retriable.retried > 0) {
      return processPendingMonitoringJobs()
    }
    return await processPendingJobs()
  } finally {
    await releaseLock(JOB_LOCK_KEY + 5)
  }
}

export async function runPostmasterSyncJob(): Promise<{ synced: number; failed: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 6)) {
    return { synced: 0, failed: 0 }
  }

  try {
    const domainsResult = await pool.query(
      `SELECT id, organization_id FROM public.mail_postmaster_domains
       WHERE connection_status = 'connected'
       AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '1 day')`
    )

    let synced = 0
    let failed = 0
    for (const domain of domainsResult.rows) {
      try {
        const result = await syncPostmasterMetrics(domain.id, domain.organization_id)
        if (result.synced) synced++
        else failed++
      } catch {
        failed++
      }
    }

    return { synced, failed }
  } finally {
    await releaseLock(JOB_LOCK_KEY + 6)
  }
}

export async function runSndsSyncJob(): Promise<{ synced: number; failed: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 7)) {
    return { synced: 0, failed: 0 }
  }

  try {
    const domainsResult = await pool.query(
      `SELECT id, organization_id FROM public.mail_snds_domains
       WHERE connection_status = 'connected'
       AND (last_sync_at IS NULL OR last_sync_at < NOW() - INTERVAL '1 day')`
    )

    let synced = 0
    let failed = 0
    for (const domain of domainsResult.rows) {
      try {
        const result = await syncSndsMetrics(domain.id, domain.organization_id)
        if (result.synced) synced++
        else failed++
      } catch {
        failed++
      }
    }

    return { synced, failed }
  } finally {
    await releaseLock(JOB_LOCK_KEY + 7)
  }
}

export async function runFullCleanupJob(): Promise<{ monitoringJobsDeleted: number; oldMetricsDeleted: number }> {
  if (!await acquireLock(JOB_LOCK_KEY + 8)) {
    return { monitoringJobsDeleted: 0, oldMetricsDeleted: 0 }
  }

  try {
    const { deleted: monitoringJobsDeleted } = await cleanupOldJobs(30)

    const metricsResult = await pool.query(
      `DELETE FROM public.mail_postmaster_metrics
       WHERE date < NOW() - INTERVAL '90 days'`
    )
    const sndsResult = await pool.query(
      `DELETE FROM public.mail_snds_metrics
       WHERE date < NOW() - INTERVAL '90 days'`
    )

    return {
      monitoringJobsDeleted,
      oldMetricsDeleted: (metricsResult.rowCount ?? 0) + (sndsResult.rowCount ?? 0),
    }
  } finally {
    await releaseLock(JOB_LOCK_KEY + 8)
  }
}

/** Proactive OAuth revoke detection within ~12–24h (PRD §6.1.13 / §6.1.16). */
export async function runOAuthHealthProbeJobWrapper() {
  const { runOAuthHealthProbeJob } = await import('@/services/mail/oauth-health-probe')
  return runOAuthHealthProbeJob()
}
