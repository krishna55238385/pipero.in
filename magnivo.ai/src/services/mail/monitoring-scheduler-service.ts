import * as monitoringRepo from '@/repositories/mail/monitoring-job-repository'
import * as domainRepo from '@/repositories/mail/domain-repository'
import { checkDomain, runMonitoringChecks } from './monitoring-service'
import type { MonitoringJobType, MonitoringJob, MonitoringConfig } from '@/types/deliverability'

export async function getMonitoringConfig(orgId: string): Promise<MonitoringConfig | null> {
  return monitoringRepo.getMonitoringConfig(orgId)
}

export async function updateMonitoringConfig(orgId: string, config: Partial<{
  dnsVerificationEnabled: boolean
  blacklistCheckEnabled: boolean
  reputationMonitoringEnabled: boolean
  postmasterSyncEnabled: boolean
  sndsSyncEnabled: boolean
  dnsCheckIntervalHours: number
  blacklistCheckIntervalHours: number
  reputationCheckIntervalHours: number
  postmasterSyncIntervalHours: number
  sndsSyncIntervalHours: number
}>): Promise<MonitoringConfig> {
  return monitoringRepo.upsertMonitoringConfig(orgId, config)
}

export async function runDnsVerification(orgId: string): Promise<{ checked: number; succeeded: number; failed: number }> {
  const job = await monitoringRepo.createMonitoringJob({
    organizationId: orgId,
    jobType: 'dns_verification',
  })

  await monitoringRepo.updateMonitoringJob(job.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  try {
    const result = await runMonitoringChecks()
    await monitoringRepo.updateMonitoringJob(job.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(job.createdAt).getTime(),
    })
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'DNS verification failed'
    await monitoringRepo.updateMonitoringJob(job.id, {
      status: 'failed',
      error: msg,
      completedAt: new Date().toISOString(),
    })
    throw err
  }
}

export async function scheduleDomainCheck(domainId: string, orgId: string): Promise<MonitoringJob> {
  const job = await monitoringRepo.createMonitoringJob({
    organizationId: orgId,
    jobType: 'dns_verification',
    domainId,
  })

  try {
    await checkDomain(domainId, orgId, 'monitoring')
    await monitoringRepo.updateMonitoringJob(job.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Check failed'
    await monitoringRepo.updateMonitoringJob(job.id, {
      status: 'failed',
      error: msg,
      completedAt: new Date().toISOString(),
    })
  }

  return monitoringRepo.getJobsByOrg(orgId, 1).then(jobs => jobs[0])
}

export async function processPendingJobs(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const pendingJobs = await monitoringRepo.getPendingJobs()
  let succeeded = 0
  let failed = 0

  for (const job of pendingJobs) {
    await monitoringRepo.updateMonitoringJob(job.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
    })

    try {
      if (job.domainId) {
        await checkDomain(job.jobType === 'dns_verification' ? job.domainId : job.domainId, job.organizationId, 'monitoring')
      }
      await monitoringRepo.updateMonitoringJob(job.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - new Date(job.createdAt).getTime(),
      })
      succeeded++
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Job failed'
      const retryCount = job.retryCount + 1

      if (retryCount < job.maxRetries) {
        const backoffMs = Math.pow(2, retryCount) * 60 * 1000
        await monitoringRepo.updateMonitoringJob(job.id, {
          status: 'failed',
          error: msg,
          retryCount,
          nextRetryAt: new Date(Date.now() + backoffMs).toISOString(),
        })
      } else {
        await monitoringRepo.updateMonitoringJob(job.id, {
          status: 'failed',
          error: msg,
          retryCount,
          completedAt: new Date().toISOString(),
        })
      }
      failed++
    }
  }

  return { processed: pendingJobs.length, succeeded, failed }
}

export async function processRetriableJobs(): Promise<{ retried: number }> {
  const retriableJobs = await monitoringRepo.getRetriableJobs()

  for (const job of retriableJobs) {
    await monitoringRepo.updateMonitoringJob(job.id, {
      status: 'pending',
      nextRetryAt: null,
    })
  }

  return { retried: retriableJobs.length }
}

export async function cleanupOldJobs(olderThanDays: number = 30): Promise<{ deleted: number }> {
  const deleted = await monitoringRepo.cleanupOldJobs(olderThanDays)
  return { deleted }
}

export async function getRecentJobs(orgId: string, limit?: number): Promise<MonitoringJob[]> {
  return monitoringRepo.getJobsByOrg(orgId, limit)
}

export async function cancelJob(id: string, orgId: string): Promise<{ success: boolean; error?: string }> {
  const jobs = await monitoringRepo.getJobsByOrg(orgId, 100)
  const job = jobs.find(j => j.id === id)
  if (!job) return { success: false, error: 'Job not found' }
  if (job.status !== 'pending') return { success: false, error: 'Can only cancel pending jobs' }

  await monitoringRepo.updateMonitoringJob(id, { status: 'cancelled' })
  return { success: true }
}
