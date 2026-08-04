import type { MailApiResult } from '@/types/mail'
import * as warmupJobRepo from '@/repositories/mail/warmup-job-repository'
import * as warmupRepo from '@/repositories/mail/warmup-repository'
import * as executionService from './warmup-execution-service'
import * as warmupQueue from './warmup-queue'
import * as notificationService from './warmup-notification-service'

let workerActive = false
const MAX_CONCURRENT = 3
let activeWorkers = 0

export function isWorkerActive(): boolean {
  return workerActive
}

export function getActiveWorkerCount(): number {
  return activeWorkers
}

export async function startWorker(): Promise<void> {
  workerActive = true
}

export async function stopWorker(): Promise<void> {
  workerActive = false
}

export async function processJob(jobId: string): Promise<MailApiResult<{
  success: boolean
  completedSends: number
  failedSends: number
}>> {
  if (activeWorkers >= MAX_CONCURRENT) {
    return { success: false, error: 'Max concurrent workers reached' }
  }

  activeWorkers++
  try {
    const job = await warmupJobRepo.findJobById(jobId)
    if (!job) {
      return { success: false, error: 'Job not found' }
    }

    if (job.status !== 'pending' && job.status !== 'queued' && job.status !== 'retrying') {
      return { success: false, error: `Job is in status "${job.status}", cannot process` }
    }

    const config = await warmupRepo.findConfigById(job.configId, job.organizationId)
    if (!config) {
      await warmupJobRepo.updateJob(jobId, { status: 'failed', lastError: 'Config not found' })
      return { success: false, error: 'Config not found' }
    }

    if (config.status !== 'running') {
      await warmupJobRepo.updateJob(jobId, { status: 'cancelled' })
      return { success: false, error: `Config is not running (status: ${config.status})` }
    }

    const pauseCheck = await executionService.evaluatePauseConditions(config, job.organizationId)
    if (pauseCheck.shouldPause) {
      await warmupJobRepo.updateJob(jobId, { status: 'cancelled' })

      await warmupRepo.updateConfig(config.id, job.organizationId, {
        status: 'paused',
        pausedAt: new Date().toISOString(),
        pauseReason: pauseCheck.reason ?? undefined,
      })

      await notificationService.notifyWarmupPaused(
        config.id,
        job.organizationId,
        pauseCheck.reason ?? 'Unknown'
      )

      return { success: false, error: `Cancelled: ${pauseCheck.reason}` }
    }

    const result = await executionService.executeJob(job, config, job.organizationId)

    await notificationService.recordAuditForAction({
      organizationId: job.organizationId,
      action: result.success ? 'execution_completed' : 'execution_failed',
      configId: job.configId,
      jobId: job.id,
      message: result.success
        ? `Job completed: ${result.completedSends} sent`
        : `Job failed: ${result.errors[0] || 'Unknown error'}`,
      metadata: {
        completedSends: result.completedSends,
        failedSends: result.failedSends,
        errors: result.errors.slice(0, 5),
      },
    })

    return {
      success: true,
      data: {
        success: result.success,
        completedSends: result.completedSends,
        failedSends: result.failedSends,
      },
    }
  } finally {
    activeWorkers--
  }
}

export async function processQueue(): Promise<number> {
  if (!workerActive) return 0

  let processed = 0
  while (activeWorkers < MAX_CONCURRENT) {
    const item = warmupQueue.dequeue()
    if (!item) break

    activeWorkers++
    processJob(item.jobId).finally(() => {
      activeWorkers--
    })
    processed++
  }

  return processed
}

export async function retryFailedJobs(): Promise<MailApiResult<number>> {
  const retryableJobs = await warmupJobRepo.findFailedJobsForRetry()
  let retried = 0

  for (const job of retryableJobs) {
    if (activeWorkers >= MAX_CONCURRENT) break

    const backoffMs = 60000 * Math.pow(2, job.retryCount)
    const nextRetry = new Date(Date.now() + backoffMs).toISOString()

    await warmupJobRepo.updateJob(job.id, {
      status: 'retrying',
      retryCount: job.retryCount + 1,
      nextRetryAt: nextRetry,
    })

    warmupQueue.enqueue(job, 1)

    await notificationService.recordAuditForAction({
      organizationId: job.organizationId,
      action: 'execution_retry',
      configId: job.configId,
      jobId: job.id,
      message: `Job retry scheduled (attempt ${job.retryCount + 1})`,
      metadata: { retryCount: job.retryCount + 1, nextRetryAt: nextRetry },
    })

    retried++
  }

  return { success: true, data: retried }
}

export async function cancelJob(jobId: string): Promise<MailApiResult<boolean>> {
  const job = await warmupJobRepo.findJobById(jobId)
  if (!job) {
    return { success: false, error: 'Job not found' }
  }

  if (job.status === 'running') {
    return { success: false, error: 'Cannot cancel a running job' }
  }

  if (job.status === 'completed') {
    return { success: false, error: 'Cannot cancel a completed job' }
  }

  await warmupJobRepo.updateJob(jobId, {
    status: 'cancelled',
    completedAt: new Date().toISOString(),
  })

  warmupQueue.removeJob(jobId)

  await notificationService.recordAuditForAction({
    organizationId: job.organizationId,
    action: 'execution_cancelled',
    configId: job.configId,
    jobId: job.id,
    message: 'Job cancelled',
    metadata: {},
  })

  return { success: true, data: true }
}

export async function cancelAllPendingJobs(configId: string): Promise<MailApiResult<number>> {
  const cancelled = await warmupJobRepo.cancelPendingJobsByConfigId(configId)

  await notificationService.recordAuditForAction({
    organizationId: 'system',
    action: 'execution_cancelled',
    configId,
    message: `${cancelled} pending jobs cancelled`,
    metadata: { cancelledCount: cancelled },
  })

  return { success: true, data: cancelled }
}

export async function getWorkerStats(): Promise<{
  active: boolean
  activeWorkers: number
  maxConcurrent: number
  queueSize: number
}> {
  return {
    active: workerActive,
    activeWorkers,
    maxConcurrent: MAX_CONCURRENT,
    queueSize: warmupQueue.size(),
  }
}
