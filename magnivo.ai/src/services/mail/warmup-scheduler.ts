import type { SchedulerHealth, SchedulerStatus, MailApiResult } from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'
import * as warmupJobRepo from '@/repositories/mail/warmup-job-repository'
import * as metricsService from './warmup-metrics-service'
import * as executionService from './warmup-execution-service'
import * as warmupQueue from './warmup-queue'
import * as recoveryService from './warmup-recovery-service'
import * as notificationService from './warmup-notification-service'

let schedulerTimer: ReturnType<typeof setInterval> | null = null
let isRunning = false
let lastRunAt: string | null = null
let lastRunDurationMs: number | null = null
let configsProcessed = 0
let jobsCreated = 0
let errorsCount = 0

export async function startScheduler(): Promise<MailApiResult<boolean>> {
  const state = await metricsService.getSchedulerState()
  if (state.status === 'running') {
    return { success: false, error: 'Scheduler is already running' }
  }

  await recoveryService.recoverOnRestart()

  await metricsService.updateSchedulerState({
    status: 'running',
    startedAt: new Date().toISOString(),
    lastHeartbeat: new Date().toISOString(),
  })

  await notificationService.recordAuditForAction({
    organizationId: 'system',
    action: 'scheduler_started',
    message: 'Warmup scheduler started',
    metadata: { startedAt: new Date().toISOString() },
  })

  schedulerTimer = setInterval(runSchedulerCycle, 60000)
  isRunning = true

  runSchedulerCycle()

  return { success: true, data: true }
}

export async function stopScheduler(): Promise<MailApiResult<boolean>> {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }

  isRunning = false

  await metricsService.updateSchedulerState({
    status: 'stopped',
  })

  await notificationService.recordAuditForAction({
    organizationId: 'system',
    action: 'scheduler_stopped',
    message: 'Warmup scheduler stopped',
    metadata: { stoppedAt: new Date().toISOString() },
  })

  return { success: true, data: true }
}

export async function pauseScheduler(): Promise<MailApiResult<boolean>> {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
  }

  isRunning = false

  await metricsService.updateSchedulerState({
    status: 'paused',
  })

  await notificationService.recordAuditForAction({
    organizationId: 'system',
    action: 'scheduler_paused',
    message: 'Warmup scheduler paused',
    metadata: { pausedAt: new Date().toISOString() },
  })

  return { success: true, data: true }
}

export async function resumeScheduler(): Promise<MailApiResult<boolean>> {
  const state = await metricsService.getSchedulerState()
  if (state.status !== 'paused') {
    return { success: false, error: 'Scheduler is not paused' }
  }

  await metricsService.updateSchedulerState({
    status: 'running',
  })

  schedulerTimer = setInterval(runSchedulerCycle, 60000)
  isRunning = true

  await notificationService.recordAuditForAction({
    organizationId: 'system',
    action: 'scheduler_resumed',
    message: 'Warmup scheduler resumed',
    metadata: { resumedAt: new Date().toISOString() },
  })

  return { success: true, data: true }
}

export async function runSchedulerOnce(): Promise<{
  configsProcessed: number
  jobsCreated: number
  errors: number
  durationMs: number
}> {
  const startTime = Date.now()
  const result = await runSchedulerCycle()
  const durationMs = Date.now() - startTime

  return {
    configsProcessed: result.configsProcessed,
    jobsCreated: result.jobsCreated,
    errors: result.errors,
    durationMs,
  }
}

export async function getSchedulerHealth(): Promise<SchedulerHealth> {
  const state = await metricsService.getSchedulerState()
  const uptimeMs = state.status === 'running' && state.lastRunAt
    ? Date.now() - new Date(state.lastRunAt).getTime()
    : 0
  return {
    status: state.status,
    lastHeartbeat: state.lastHeartbeat,
    uptime: uptimeMs,
    lastRunAt: state.lastRunAt,
    lastRunDurationMs: state.lastRunDurationMs,
    configsProcessed,
    jobsCreated,
    errorsCount,
  }
}

export function getSchedulerStatus(): SchedulerStatus {
  return isRunning ? 'running' : 'stopped'
}

export function isSchedulerRunning(): boolean {
  return isRunning
}

async function runSchedulerCycle(): Promise<{
  configsProcessed: number
  jobsCreated: number
  errors: number
}> {
  const cycleStart = Date.now()
  let localConfigsProcessed = 0
  let localJobsCreated = 0
  let localErrors = 0

  try {
    await metricsService.recordHeartbeat()

    const orgIds = await getAllOrgIdsWithActiveWarmups()

    for (const orgId of orgIds) {
      try {
        const { processed, created, errors } = await processOrgConfigs(orgId)
        localConfigsProcessed += processed
        localJobsCreated += created
        localErrors += errors
      } catch {
        localErrors++
      }
    }

    await warmupQueue.enqueueRunnableJobs()

    let processedFromQueue = 0
    const maxProcess = 10
    while (processedFromQueue < maxProcess) {
      const item = await warmupQueue.processNext()
      if (!item) break

      try {
        const job = await warmupJobRepo.findJobById(item.jobId)
        if (!job) continue

        const config = await warmupRepo.findConfigById(job.configId, job.organizationId)
        if (!config || config.status !== 'running') {
          await warmupJobRepo.updateJob(job.id, { status: 'cancelled' })
          continue
        }

        const pauseCheck = await executionService.evaluatePauseConditions(config, job.organizationId)
        if (pauseCheck.shouldPause) {
          await warmupJobRepo.updateJob(job.id, { status: 'cancelled' })

          await warmupRepo.updateConfig(job.configId, job.organizationId, {
            status: 'paused',
            pausedAt: new Date().toISOString(),
            pauseReason: pauseCheck.reason ?? undefined,
          })

          await notificationService.notifyWarmupPaused(
            job.configId,
            job.organizationId,
            pauseCheck.reason ?? 'Unknown'
          )
          continue
        }

        await executionService.executeJob(job, config, job.organizationId)
        processedFromQueue++
      } catch {
        localErrors++
      }
    }
  } catch {
    localErrors++
  }

  lastRunAt = new Date().toISOString()
  lastRunDurationMs = Date.now() - cycleStart
  configsProcessed = localConfigsProcessed
  jobsCreated = localJobsCreated
  errorsCount = localErrors

  if (localErrors > 0) {
    await metricsService.incrementErrorsCount(localErrors)
  }

  if (localConfigsProcessed > 0) {
    await metricsService.incrementConfigsProcessed(localConfigsProcessed)
  }

  if (localJobsCreated > 0) {
    await metricsService.incrementJobsCreated(localJobsCreated)
  }

  return {
    configsProcessed: localConfigsProcessed,
    jobsCreated: localJobsCreated,
    errors: localErrors,
  }
}

async function getAllOrgIdsWithActiveWarmups(): Promise<string[]> {
  const result = await import('@/lib/db').then(m => m.default.query(
    `SELECT DISTINCT organization_id FROM public.mail_warmup_configs WHERE status = 'running'`
  ))
  return result.rows.map((r: { organization_id: string }) => r.organization_id)
}

async function processOrgConfigs(orgId: string): Promise<{
  processed: number
  created: number
  errors: number
}> {
  let processed = 0
  let created = 0
  let errors = 0

  const configs = await warmupRepo.findConfigsByStatus(orgId, 'running')

  for (const config of configs) {
    try {
      processed++

      const pauseCheck = await executionService.evaluatePauseConditions(config, orgId)
      if (pauseCheck.shouldPause) {
        await warmupRepo.updateConfig(config.id, orgId, {
          status: 'paused',
          pausedAt: new Date().toISOString(),
          pauseReason: pauseCheck.reason ?? undefined,
        })

        await notificationService.notifyWarmupPaused(
          config.id,
          orgId,
          pauseCheck.reason ?? 'Unknown'
        )

        await warmupRepo.insertEvent({
          configId: config.id,
          organizationId: orgId,
          eventType: 'paused',
          previousStatus: 'running',
          newStatus: 'paused',
          message: `Auto-paused: ${pauseCheck.reason}`,
          metadata: { reason: pauseCheck.reason, automatic: true },
        })

        await notificationService.recordAuditForAction({
          organizationId: orgId,
          action: 'execution_skipped',
          configId: config.id,
          message: `Config auto-paused: ${pauseCheck.reason}`,
          metadata: { reason: pauseCheck.reason },
        })
        continue
      }

      const targetCalc = await executionService.calculateTargetSends(config)
      if (!targetCalc.shouldExecute) {
        continue
      }

      const job = await executionService.createJobForConfig(config, orgId)
      if (job) {
        created++
        warmupQueue.enqueue(job)

        await notificationService.recordAuditForAction({
          organizationId: orgId,
          action: 'job_created',
          configId: config.id,
          jobId: job.id,
          message: `Job created: ${job.targetSends} sends targeted`,
          metadata: {
            targetSends: job.targetSends,
            currentDay: config.currentDay,
            stage: config.stage,
          },
        })
      }
    } catch {
      errors++
    }
  }

  return { processed, created, errors }
}
