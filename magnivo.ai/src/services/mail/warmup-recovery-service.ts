import type { WarmupConfigModel } from '@/types/mail'
import * as warmupJobRepo from '@/repositories/mail/warmup-job-repository'
import * as warmupRepo from '@/repositories/mail/warmup-repository'
import * as warmupQueue from './warmup-queue'
import * as notificationService from './warmup-notification-service'

export async function recoverStuckJobs(timeoutMinutes: number = 30): Promise<number> {
  const stuckJobs = await warmupJobRepo.findStuckJobs(timeoutMinutes)
  let recovered = 0

  for (const job of stuckJobs) {
    try {
      if (job.retryCount < job.maxRetries) {
        const backoffMs = calculateBackoff(job.retryCount)
        const nextRetry = new Date(Date.now() + backoffMs).toISOString()

        await warmupJobRepo.updateJob(job.id, {
          status: 'retrying',
          retryCount: job.retryCount + 1,
          nextRetryAt: nextRetry,
          lastError: 'Job stuck - recovered by scheduler',
          errorCategory: 'timeout',
        })

        await notificationService.recordAuditForAction({
          organizationId: job.organizationId,
          action: 'recovery_triggered',
          configId: job.configId,
          jobId: job.id,
          message: `Stuck job recovered, retry scheduled at ${nextRetry}`,
          metadata: { timeoutMinutes, retryCount: job.retryCount + 1 },
        })
      } else {
        await warmupJobRepo.updateJob(job.id, {
          status: 'failed',
          lastError: 'Job stuck and max retries exceeded',
          completedAt: new Date().toISOString(),
        })

        await warmupRepo.insertEvent({
          configId: job.configId,
          organizationId: job.organizationId,
          eventType: 'error',
          previousStatus: null,
          newStatus: null,
          message: 'Warmup job failed: stuck and max retries exceeded',
          metadata: { jobId: job.id },
        })

        await notificationService.notifyExecutionFailed(
          job.configId,
          job.organizationId,
          'Job stuck and max retries exceeded'
        )
      }

      recovered++
    } catch {
      continue
    }
  }

  return recovered
}

export async function recoverInterruptedJobs(): Promise<number> {
  const runningJobs = await warmupJobRepo.findJobsByOrg('', 'running' as never)

  let recovered = 0
  for (const job of runningJobs) {
    try {
      if (job.retryCount < job.maxRetries) {
        const backoffMs = calculateBackoff(job.retryCount)
        const nextRetry = new Date(Date.now() + backoffMs).toISOString()

        await warmupJobRepo.updateJob(job.id, {
          status: 'retrying',
          retryCount: job.retryCount + 1,
          nextRetryAt: nextRetry,
          lastError: 'Interrupted - recovered on restart',
          errorCategory: 'timeout',
        })

        await notificationService.recordAuditForAction({
          organizationId: job.organizationId,
          action: 'recovery_triggered',
          configId: job.configId,
          jobId: job.id,
          message: 'Interrupted job recovered on restart',
          metadata: { retryCount: job.retryCount + 1 },
        })
      } else {
        await warmupJobRepo.updateJob(job.id, {
          status: 'failed',
          lastError: 'Interrupted and max retries exceeded',
          completedAt: new Date().toISOString(),
        })
      }
      recovered++
    } catch {
      continue
    }
  }

  return recovered
}

export async function clearStalePendingJobs(): Promise<number> {
  const staleThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const result = await warmupJobRepo.findRunnableJobs()
  let cleared = 0

  for (const job of result) {
    if (job.scheduledAt < staleThreshold && job.status === 'pending') {
      await warmupJobRepo.updateJob(job.id, { status: 'cancelled' })
      warmupQueue.removeJob(job.id)
      cleared++
    }
  }

  return cleared
}

export async function recoverOnRestart(): Promise<{
  stuckJobs: number
  interruptedJobs: number
  staleJobs: number
}> {
  const stuckJobs = await recoverStuckJobs()
  const interruptedJobs = await recoverInterruptedJobs()
  const staleJobs = await clearStalePendingJobs()

  await notificationService.recordAuditForAction({
    organizationId: 'system',
    action: 'recovery_triggered',
    message: `Recovery complete: ${stuckJobs} stuck, ${interruptedJobs} interrupted, ${staleJobs} stale jobs handled`,
    metadata: { stuckJobs, interruptedJobs, staleJobs },
  })

  return { stuckJobs, interruptedJobs, staleJobs }
}

export async function canRecoverConfig(config: WarmupConfigModel): Promise<{
  recoverable: boolean
  reasons: string[]
}> {
  const reasons: string[] = []

  if (config.status === 'failed') {
    reasons.push('Config is in failed state')
  }

  if (config.health === 'critical') {
    reasons.push('Health is critical')
  }

  const failedJobs = await warmupJobRepo.findJobsByConfigId(config.id)
  const consecutiveFailures = failedJobs
    .filter(j => j.status === 'failed')
    .length

  if (consecutiveFailures >= 5) {
    reasons.push(`${consecutiveFailures} consecutive job failures`)
  }

  return {
    recoverable: reasons.length === 0,
    reasons,
  }
}

function calculateBackoff(retryCount: number): number {
  const baseMs = 60000
  const maxMs = 3600000
  const jitter = Math.random() * 10000
  return Math.min(baseMs * Math.pow(2, retryCount), maxMs) + jitter
}
