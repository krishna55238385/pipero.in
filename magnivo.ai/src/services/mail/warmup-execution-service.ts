import type { WarmupConfigModel, WarmupJob, WarmupExecution, MailApiResult } from '@/types/mail'
import * as warmupJobRepo from '@/repositories/mail/warmup-job-repository'
import * as warmupExecRepo from '@/repositories/mail/warmup-execution-repository'
import * as warmupRepo from '@/repositories/mail/warmup-repository'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import * as progressService from './warmup-progress-service'
import * as healthService from './warmup-health-service'
import * as stageService from './warmup-stage-service'
import * as notificationService from './warmup-notification-service'
import * as metricsService from './warmup-metrics-service'
import * as warmupPool from './warmup-pool-service'
import { enforceWarmupDailyCap } from './warmup-stage-service'

function generateRandomSubject(): string {
  const subjects = [
    'Quick check-in',
    'Following up on our conversation',
    'Great connecting with you',
    'Wanted to share something useful',
    'Checking in',
    'Hope you are doing well',
    'Thought you might find this interesting',
    'Just a quick note',
    'Hello from my inbox',
    'Hope your week is going well',
    'Sharing a quick update',
    'Thanks for your time',
    'Looking forward to hearing from you',
    'Wanted to reach out',
    'Hope all is well',
  ]
  return subjects[Math.floor(Math.random() * subjects.length)]
}

function classifyError(error: unknown): { category: string; retryable: boolean } {
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return { category: 'timeout', retryable: true }
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('network')) {
    return { category: 'network', retryable: true }
  }
  if (lower.includes('rate') || lower.includes('429') || lower.includes('too many')) {
    return { category: 'rate_limit', retryable: true }
  }
  if (lower.includes('temporary') || lower.includes('try again')) {
    return { category: 'temporary_smtp', retryable: true }
  }
  if (lower.includes('invalid') && (lower.includes('credential') || lower.includes('password') || lower.includes('auth'))) {
    return { category: 'invalid_credentials', retryable: false }
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return { category: 'permission_failure', retryable: false }
  }
  if (lower.includes('revoked') || lower.includes('expired') || lower.includes('oauth')) {
    return { category: 'revoked_oauth', retryable: false }
  }
  return { category: 'unknown', retryable: true }
}

function isWeekendInTimezone(timezone: string): boolean {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
    })
    const day = formatter.format(now)
    return day === 'Saturday' || day === 'Sunday'
  } catch {
    const day = new Date().getDay()
    return day === 0 || day === 6
  }
}

function isWithinBusinessHours(
  businessHoursStart: number,
  businessHoursEnd: number,
  timezone: string
): boolean {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    })
    const currentHour = parseInt(formatter.format(now), 10)
    return currentHour >= businessHoursStart && currentHour < businessHoursEnd
  } catch {
    const currentHour = new Date().getHours()
    return currentHour >= businessHoursStart && currentHour < businessHoursEnd
  }
}

export async function evaluatePauseConditions(
  config: WarmupConfigModel,
  orgId: string
): Promise<{ shouldPause: boolean; reason: string | null }> {
  const mailbox = await mailboxRepo.findMailboxById(config.mailboxId, orgId)
  if (!mailbox) {
    return { shouldPause: true, reason: 'Mailbox not found' }
  }

  if (mailbox.mailboxStatus === 'disabled') {
    return { shouldPause: true, reason: 'Mailbox is disabled' }
  }

  if (mailbox.mailboxStatus === 'oauth_expired') {
    return { shouldPause: true, reason: 'OAuth credentials have expired' }
  }

  if (mailbox.mailboxStatus === 'smtp_failed') {
    return { shouldPause: true, reason: 'SMTP authentication failed' }
  }

  if (mailbox.mailboxStatus === 'imap_failed') {
    return { shouldPause: true, reason: 'IMAP connection failed' }
  }

  if (mailbox.mailboxStatus === 'verification_failed') {
    return { shouldPause: true, reason: 'Mailbox verification failed' }
  }

  if (config.health === 'critical') {
    return { shouldPause: true, reason: 'Health is critical' }
  }

  if (config.failureReason?.includes('maximum failures')) {
    return { shouldPause: true, reason: 'Maximum failure threshold reached' }
  }

  return { shouldPause: false, reason: null }
}

async function runPostSendWarmupBehaviors(input: {
  config: WarmupConfigModel
  orgId: string
  partner: warmupPool.WarmupPoolMailbox
  subject: string
  interactionId: string
  executionId: string
}): Promise<void> {
  const { config, orgId, partner, subject, interactionId, executionId } = input
  let placedIn: warmupPool.WarmupPlacement = 'unknown'
  let opened = false
  let spamRescued = false
  let replied = false

  if (config.openSimulation || config.readSimulation) {
    if (partner.imapHost && partner.encryptedImapPassword) {
      opened = await warmupPool.markWarmupMessageRead(partner, subject)
    } else {
      await warmupPool.recordSimulatedOpenMetric({
        organizationId: orgId,
        clientMailboxId: config.mailboxId,
        configId: config.id,
      })
      opened = true
    }
  }

  if (config.spamRescue) {
    placedIn = await warmupPool.detectWarmupPlacement(partner, subject)
    if (placedIn === 'spam') {
      spamRescued = await warmupPool.moveWarmupFromSpamToInbox(partner, subject)
      if (spamRescued) placedIn = 'inbox'
    }
  }

  if (config.replySimulation && Math.random() < 0.1) {
    await warmupPool.insertWarmupReplyEvent({
      organizationId: orgId,
      configId: config.id,
      clientMailboxId: config.mailboxId,
      poolMailboxId: partner.id,
      executionId,
      subject: `Re: ${subject}`,
    })
    replied = true
  }

  await warmupPool.updateWarmupInteractionFlags(interactionId, {
    opened,
    replied,
    spamRescued,
    placedIn,
  })

  if (opened || replied) {
    await progressService.recordSendOutcome(config.id, orgId, new Date().toISOString().split('T')[0], {
      sent: false,
      successful: true,
      bounced: false,
      replied,
      opened,
      clicked: false,
      spamReport: placedIn === 'spam' && !spamRescued,
    })
  }

  await warmupPool.recordPartnerSuccess(partner.id)
}

export async function createJobForConfig(
  config: WarmupConfigModel,
  orgId: string
): Promise<WarmupJob | null> {
  if (!config.startDate) return null

  const todayStats = await warmupRepo.findTodayStats(config.id)
  const completedToday = todayStats?.actualSends ?? 0
  const cappedTarget = enforceWarmupDailyCap(config.currentDay, config.currentDailyTarget)
  const remainingSends = Math.max(0, cappedTarget - completedToday)

  if (remainingSends <= 0) return null

  const job = await warmupJobRepo.insertJob({
    configId: config.id,
    organizationId: orgId,
    status: 'pending',
    scheduledAt: new Date().toISOString(),
    targetSends: remainingSends,
    mailboxId: config.mailboxId,
    poolId: null,
    maxRetries: 3,
    metadata: {
      currentDay: config.currentDay,
      stage: config.stage,
    },
  })

  return job
}

export async function calculateTargetSends(config: WarmupConfigModel): Promise<{
  todayAllowed: number
  alreadyCompleted: number
  remaining: number
  shouldExecute: boolean
  skipReason: string | null
}> {
  const todayAllowed = enforceWarmupDailyCap(config.currentDay, config.currentDailyTarget)

  const todayStats = await warmupRepo.findTodayStats(config.id)
  const alreadyCompleted = todayStats?.actualSends ?? 0
  const remaining = Math.max(0, todayAllowed - alreadyCompleted)

  if (remaining <= 0) {
    return { todayAllowed, alreadyCompleted, remaining: 0, shouldExecute: false, skipReason: 'Daily target reached' }
  }

  if (!config.weekendSending && isWeekendInTimezone(config.timezone)) {
    return { todayAllowed, alreadyCompleted, remaining, shouldExecute: false, skipReason: 'Weekend sending disabled' }
  }

  if (!isWithinBusinessHours(config.businessHoursStart, config.businessHoursEnd, config.timezone)) {
    return { todayAllowed, alreadyCompleted, remaining, shouldExecute: false, skipReason: 'Outside business hours' }
  }

  return { todayAllowed, alreadyCompleted, remaining, shouldExecute: true, skipReason: null }
}

export async function executeJob(
  job: WarmupJob,
  config: WarmupConfigModel,
  orgId: string
): Promise<{ success: boolean; completedSends: number; failedSends: number; errors: string[] }> {
  const startTime = Date.now()

  await warmupJobRepo.updateJob(job.id, {
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  await notificationService.recordAuditForAction({
    organizationId: orgId,
    action: 'execution_started',
    configId: config.id,
    jobId: job.id,
    message: `Job started with target ${job.targetSends} sends`,
    metadata: { targetSends: job.targetSends },
  })

  let completedSends = 0
  let failedSends = 0
  const errors: string[] = []

  for (let i = 0; i < job.targetSends; i++) {
    const mailbox = await mailboxRepo.findMailboxById(config.mailboxId, orgId)
    const clientDomain = mailbox?.email?.split('@')[1]?.toLowerCase()
    const partner = await warmupPool.pickHealthyPoolPartner(clientDomain, orgId)
    if (!partner) {
      errors.push('No healthy Magnivo warmup-pool partners available')
      failedSends++
      break
    }

    const content = warmupPool.generateWarmupContent(mailbox?.senderName || mailbox?.displayName || mailbox?.email || 'team')
    const subject = content.subject || generateRandomSubject()

    const execution = await warmupExecRepo.insertExecution({
      jobId: job.id,
      configId: config.id,
      organizationId: orgId,
      status: 'pending',
      recipientEmail: partner.email,
      subject,
    })

    let sendStart = Date.now()
    try {
      sendStart = Date.now()
      await warmupPool.sendWarmupFromClientMailbox({
        organizationId: orgId,
        mailboxId: config.mailboxId,
        toEmail: partner.email,
        subject,
        html: content.html,
        text: content.text,
      })
      const durationMs = Date.now() - sendStart

      await warmupExecRepo.updateExecution(execution.id, {
        status: 'sent',
        sentAt: new Date().toISOString(),
        durationMs,
      })

      const interactionId = await warmupPool.recordWarmupInteraction({
        organizationId: orgId,
        clientMailboxId: config.mailboxId,
        poolMailboxId: partner.id,
        configId: config.id,
        executionId: execution.id,
        subject,
        placedIn: 'unknown',
      })

      await progressService.recordSendOutcome(config.id, orgId, new Date().toISOString().split('T')[0], {
        sent: true,
        successful: true,
        bounced: false,
        replied: false,
        opened: false,
        clicked: false,
        spamReport: false,
      })

      try {
        await runPostSendWarmupBehaviors({
          config,
          orgId,
          partner,
          subject,
          interactionId,
          executionId: execution.id,
        })
      } catch (postErr) {
        console.error(
          '[warmup-execution] post-send behaviors:',
          postErr instanceof Error ? postErr.message : postErr
        )
      }

      completedSends++
    } catch (err) {
      const errorInfo = classifyError(err)
      const durationMs = Date.now() - sendStart

      await warmupExecRepo.updateExecution(execution.id, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
        durationMs,
      })

      await progressService.recordSendOutcome(config.id, orgId, new Date().toISOString().split('T')[0], {
        sent: true,
        successful: false,
        bounced: false,
        replied: false,
        opened: false,
        clicked: false,
        spamReport: false,
      })

      failedSends++
      errors.push(`${errorInfo.category}: ${err instanceof Error ? err.message : String(err)}`)

      if (/blacklist|spam|blocked/i.test(String(err))) {
        await warmupPool.markPoolMailboxUnhealthy(partner.id, err instanceof Error ? err.message : String(err))
      } else {
        await warmupPool.recordPartnerFailure(partner.id, err instanceof Error ? err.message : String(err))
      }

      if (!errorInfo.retryable) {
        break
      }
    }

    if (i < job.targetSends - 1) {
      const delay = config.minDelayMs + Math.random() * (config.maxDelayMs - config.minDelayMs)
      await new Promise(resolve => setTimeout(resolve, Math.min(delay, 5000)))
    }
  }

  const allFailed = failedSends > 0 && completedSends === 0
  const jobStatus = allFailed ? 'failed' : 'completed'

  await warmupJobRepo.updateJob(job.id, {
    status: jobStatus,
    completedAt: new Date().toISOString(),
    completedSends,
    failedSends,
    ...(allFailed ? {
      lastError: errors[errors.length - 1] || 'All sends failed',
      errorCategory: classifyError(errors[errors.length - 1] || '').category,
    } : {}),
  })

  const durationMs = Date.now() - startTime
  await metricsService.recordAuditLog({
    organizationId: orgId,
    action: 'execution_completed',
    configId: config.id,
    jobId: job.id,
    message: `Job completed: ${completedSends} sent, ${failedSends} failed in ${durationMs}ms`,
    metadata: { completedSends, failedSends, durationMs },
  })

  if (completedSends > 0) {
    const healthChange = await healthService.evaluateHealthChange(config.id, orgId)

    if (healthChange.changed) {
      await notificationService.notifyHealthDegraded(
        config.id,
        orgId,
        healthChange.newHealth,
        healthChange.healthScore
      )
    }

    if (config.currentDay >= config.totalDays || healthChange.newHealth === 'excellent') {
      const graduationCheck = await healthService.checkGraduationReadiness(config)
      if (graduationCheck.ready) {
        const newDay = config.currentDay + 1
        await warmupRepo.updateConfig(config.id, orgId, {
          currentDay: newDay,
          status: 'graduated',
          graduatedAt: new Date().toISOString(),
        })

        await warmupRepo.insertEvent({
          configId: config.id,
          organizationId: orgId,
          eventType: 'graduated',
          previousStatus: config.status,
          newStatus: 'graduated',
          previousStage: config.stage,
          newStage: 'graduated',
          message: 'Warmup graduated successfully',
          metadata: { healthScore: healthChange.healthScore },
        })

        await notificationService.notifyWarmupGraduated(
          config.id,
          orgId,
          healthChange.healthScore
        )
      }
    } else {
      const stageAdvancement = await stageService.advanceStageIfNeeded(config)
      if (stageAdvancement.advanced) {
        await warmupRepo.insertEvent({
          configId: config.id,
          organizationId: orgId,
          eventType: 'stage_changed',
          previousStage: config.stage,
          newStage: stageAdvancement.newStage,
          message: `Stage changed to ${stageAdvancement.newStage}`,
        })
      }
    }
  }

  return { success: !allFailed, completedSends, failedSends, errors }
}

export async function getExecutionsForJob(jobId: string): Promise<WarmupExecution[]> {
  return warmupExecRepo.findExecutionsByJobId(jobId)
}

export async function getExecutionsForConfig(configId: string, limit?: number): Promise<WarmupExecution[]> {
  return warmupExecRepo.findExecutionsByConfigId(configId, limit)
}

export async function cancelExecution(executionId: string): Promise<MailApiResult<boolean>> {
  const execution = await warmupExecRepo.findExecutionById(executionId)
  if (!execution) {
    return { success: false, error: 'Execution not found' }
  }

  if (execution.status !== 'pending') {
    return { success: false, error: 'Can only cancel pending executions' }
  }

  await warmupExecRepo.updateExecution(executionId, {
    status: 'skipped',
    errorMessage: 'Cancelled by user',
  })

  return { success: true, data: true }
}

export async function retryExecution(executionId: string): Promise<MailApiResult<boolean>> {
  const execution = await warmupExecRepo.findExecutionById(executionId)
  if (!execution) {
    return { success: false, error: 'Execution not found' }
  }

  if (!['failed', 'bounced'].includes(execution.status)) {
    return { success: false, error: 'Can only retry failed or bounced executions' }
  }

  const job = await warmupJobRepo.findJobById(execution.jobId)
  if (!job) {
    return { success: false, error: 'Parent job not found' }
  }

  const config = await warmupRepo.findConfigById(execution.configId, execution.organizationId)
  if (!config) {
    return { success: false, error: 'Config not found' }
  }

  await warmupExecRepo.updateExecution(executionId, {
    status: 'pending',
    errorMessage: null,
    sentAt: null,
    deliveredAt: null,
    bouncedAt: null,
    failedAt: null,
  })

  return { success: true, data: true }
}
