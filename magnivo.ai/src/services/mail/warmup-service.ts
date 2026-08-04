import type {
  CreateWarmupConfigRequest,
  UpdateWarmupConfigRequest,
  WarmupConfigModel,
  WarmupConfigResponse,
  WarmupConfigWithStats,
  WarmupBulkRequest,
  WarmupBulkResult,
  WarmupDashboardStats,
  MailApiResult,
  MailErrorCode,
  WarmupConfigStatus,
} from '@/types/mail'
import { MAIL_ERROR_MESSAGES } from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import * as validationService from './warmup-validation-service'
import * as configurationService from './warmup-configuration-service'
import * as healthService from './warmup-health-service'
import * as progressService from './warmup-progress-service'
import * as stageService from './warmup-stage-service'
import * as statisticsService from './warmup-statistics-service'
import * as mailValidation from '@/lib/mail-validation'

type ActorInfo = { userId: string; email: string }

function errorResult(code: MailErrorCode): MailApiResult<never> {
  return { success: false, error: MAIL_ERROR_MESSAGES[code] }
}

function errorResultRaw(message: string): MailApiResult<never> {
  return { success: false, error: message }
}

function successResult<T>(data: T): MailApiResult<T> {
  return { success: true, data }
}

function configToResponse(model: WarmupConfigModel, mailboxEmail: string, mailboxProvider: string): WarmupConfigResponse {
  return {
    id: model.id,
    organizationId: model.organizationId,
    mailboxId: model.mailboxId,
    mailboxEmail,
    mailboxProvider: mailboxProvider as WarmupConfigResponse['mailboxProvider'],
    status: model.status,
    stage: model.stage,
    health: model.health,
    startDate: model.startDate,
    endDate: model.endDate,
    currentDay: model.currentDay,
    totalDays: model.totalDays,
    initialSends: model.initialSends,
    maxDailySends: model.maxDailySends,
    dailyIncrease: model.dailyIncrease,
    currentDailyTarget: model.currentDailyTarget,
    weekendSending: model.weekendSending,
    businessHoursStart: model.businessHoursStart,
    businessHoursEnd: model.businessHoursEnd,
    timezone: model.timezone,
    minDelayMs: model.minDelayMs,
    maxDelayMs: model.maxDelayMs,
    randomizationFactor: model.randomizationFactor,
    replySimulation: model.replySimulation,
    readSimulation: model.readSimulation,
    spamRescue: model.spamRescue,
    openSimulation: model.openSimulation,
    clickSimulation: model.clickSimulation,
    targetHealthScore: model.targetHealthScore,
    graduationThreshold: model.graduationThreshold,
    pauseThreshold: model.pauseThreshold,
    resumeThreshold: model.resumeThreshold,
    pauseReason: model.pauseReason,
    failureReason: model.failureReason,
    metadata: model.metadata,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  }
}

async function loadConfig(configId: string, orgId: string): Promise<WarmupConfigModel | null> {
  return warmupRepo.findConfigById(configId, orgId)
}

async function loadMailbox(mailboxId: string, orgId: string) {
  return mailboxRepo.findMailboxById(mailboxId, orgId)
}

async function buildResponse(config: WarmupConfigModel, orgId: string): Promise<WarmupConfigResponse> {
  const mailbox = await loadMailbox(config.mailboxId, orgId)
  return configToResponse(config, mailbox?.email ?? '', mailbox?.provider ?? '')
}

export async function createWarmup(
  orgId: string,
  input: CreateWarmupConfigRequest,
  actor: ActorInfo
): Promise<MailApiResult<WarmupConfigResponse>> {
  try {
    const validation = await validationService.validateCanStartWarmup(orgId, input.mailboxId)
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    const mailbox = await loadMailbox(input.mailboxId, orgId)
    if (!mailbox) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const config = await configurationService.buildWarmupConfigFromRequest(orgId, input)

    await stageService.initializeStages(config)
    await progressService.initializeDailyProgress(config)

    await warmupRepo.insertEvent({
      configId: config.id,
      organizationId: orgId,
      eventType: 'created',
      previousStatus: null,
      newStatus: config.status,
      previousStage: null,
      newStage: config.stage,
      previousHealth: null,
      newHealth: config.health,
      message: `Warmup created for ${mailbox.email}`,
      metadata: { mailboxId: config.mailboxId },
    })

    await warmupRepo.insertHistory({
      configId: config.id,
      organizationId: orgId,
      action: 'created',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: null,
      newConfig: config as unknown as Record<string, unknown>,
      metadata: {},
    })

    const response = configurationService.toWarmupConfigResponse(config, mailbox)
    return successResult(response)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function startWarmup(
  configId: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<WarmupConfigResponse>> {
  try {
    const config = await loadConfig(configId, orgId)
    if (!config) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const allowedStatuses: WarmupConfigStatus[] = ['draft', 'pending']
    if (!allowedStatuses.includes(config.status)) {
      return errorResultRaw(`Cannot start warmup with status "${config.status}". Must be "draft" or "pending"`)
    }

    // PRD §6.2 / §14: SPF+DKIM required before warmup; DMARC may be at-risk override
    const { evaluateDnsGateForMailbox, applyDnsGateStatus } = await import('./dns-gate-service')
    const gate = await evaluateDnsGateForMailbox(config.mailboxId, orgId)
    if (!gate.canWarmup) {
      await applyDnsGateStatus(config.mailboxId, orgId).catch(() => {})
      return errorResultRaw(
        gate.message || 'Complete DNS setup (SPF + DKIM) before starting warmup, or use the at-risk override'
      )
    }
    const mailbox = await mailboxRepo.findMailboxById(config.mailboxId, orgId)
    if (!mailbox) return errorResultRaw('Mailbox not found')
    if (
      mailbox.mailboxStatus !== 'pending_warmup' &&
      mailbox.mailboxStatus !== 'at_risk' &&
      mailbox.mailboxStatus !== 'connected' &&
      mailbox.mailboxStatus !== 'warming'
    ) {
      // Align status from gate when still pending_dns
      if (mailbox.mailboxStatus === 'pending_dns') {
        return errorResultRaw('Complete DNS setup (SPF + DKIM) before starting warmup, or use the at-risk override')
      }
      return errorResultRaw(`Mailbox status "${mailbox.mailboxStatus}" is not eligible for warmup`)
    }

    const previousStatus = config.status
    const now = new Date().toISOString()
    const updated = await warmupRepo.updateConfig(configId, orgId, {
      status: 'running',
      startDate: now,
    })

    if (!updated) {
      return errorResult('DATABASE_FAILURE')
    }

    try {
      await mailboxRepo.transitionMailboxStatus(config.mailboxId, orgId, 'warming')
    } catch {
      // non-fatal if transition helper unavailable in tests
    }

    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'started',
      previousStatus,
      newStatus: 'running',
      previousStage: config.stage,
      newStage: config.stage,
      previousHealth: config.health,
      newHealth: config.health,
      message: 'Warmup started',
      metadata: {},
    })

    await warmupRepo.insertHistory({
      configId,
      organizationId: orgId,
      action: 'started',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: { status: previousStatus } as Record<string, unknown>,
      newConfig: { status: 'running', startDate: now } as Record<string, unknown>,
      metadata: {},
    })

    const response = await buildResponse(updated, orgId)
    return successResult(response)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function pauseWarmup(
  configId: string,
  orgId: string,
  reason: string,
  actor: ActorInfo
): Promise<MailApiResult<WarmupConfigResponse>> {
  try {
    const config = await loadConfig(configId, orgId)
    if (!config) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const validation = validationService.validateCanPauseWarmup(config)
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    const previousStatus = config.status
    const now = new Date().toISOString()
    const updated = await warmupRepo.updateConfig(configId, orgId, {
      status: 'paused',
      pausedAt: now,
      pauseReason: reason,
    })

    if (!updated) {
      return errorResult('DATABASE_FAILURE')
    }

    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'paused',
      previousStatus,
      newStatus: 'paused',
      previousStage: config.stage,
      newStage: config.stage,
      previousHealth: config.health,
      newHealth: config.health,
      message: `Warmup paused: ${reason}`,
      metadata: { reason },
    })

    await warmupRepo.insertHistory({
      configId,
      organizationId: orgId,
      action: 'paused',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: { status: previousStatus } as Record<string, unknown>,
      newConfig: { status: 'paused', pausedAt: now, pauseReason: reason } as Record<string, unknown>,
      metadata: { reason },
    })

    await warmupRepo.insertNotification({
      configId,
      organizationId: orgId,
      notificationType: 'paused',
      severity: 'info',
      title: 'Warmup Paused',
      message: `Warmup paused: ${reason}`,
      metadata: {},
    })

    const response = await buildResponse(updated, orgId)
    return successResult(response)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

/**
 * Cancel warmup when mailbox is disconnected/deleted mid-ramp (PRD §15).
 * Not resumable — reconnecting restarts warmup from scratch.
 */
export async function cancelWarmupForMailbox(
  mailboxId: string,
  orgId: string,
  reason: string
): Promise<void> {
  const config = await warmupRepo.findActiveConfigByMailboxId(mailboxId, orgId)
  if (!config) return
  if (['graduated', 'completed', 'cancelled'].includes(config.status)) return

  const { cancelAllPendingJobs } = await import('./warmup-worker')
  await cancelAllPendingJobs(config.id).catch(() => {})

  const previousStatus = config.status
  await warmupRepo.updateConfig(config.id, orgId, {
    status: 'cancelled',
    pauseReason: reason,
    failureReason: reason,
  })

  await warmupRepo.insertEvent({
    configId: config.id,
    organizationId: orgId,
    eventType: 'error',
    previousStatus,
    newStatus: 'cancelled',
    previousStage: config.stage,
    newStage: config.stage,
    previousHealth: config.health,
    newHealth: config.health,
    message: `Warmup cancelled: ${reason}`,
    metadata: { reason, mailboxId },
  })

  await mailboxRepo.updateMailbox(mailboxId, orgId, { metadata: { warmupCancelledAt: new Date().toISOString() } }).catch(() => {})
  const db = (await import('@/lib/db')).default
  await db.query(
    `UPDATE public.mail_mailboxes
     SET warmup_status = 'idle', updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [mailboxId, orgId]
  ).catch(() => {})
}

export async function resumeWarmup(
  configId: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<WarmupConfigResponse>> {
  try {
    const config = await loadConfig(configId, orgId)
    if (!config) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const validation = validationService.validateCanResumeWarmup(config)
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    const previousStatus = config.status
    const now = new Date().toISOString()
    const updated = await warmupRepo.updateConfig(configId, orgId, {
      status: 'running',
      resumedAt: now,
      pauseReason: null,
    })

    if (!updated) {
      return errorResult('DATABASE_FAILURE')
    }

    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'resumed',
      previousStatus,
      newStatus: 'running',
      previousStage: config.stage,
      newStage: config.stage,
      previousHealth: config.health,
      newHealth: config.health,
      message: 'Warmup resumed',
      metadata: {},
    })

    await warmupRepo.insertHistory({
      configId,
      organizationId: orgId,
      action: 'resumed',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: { status: previousStatus } as Record<string, unknown>,
      newConfig: { status: 'running', resumedAt: now, pauseReason: null } as Record<string, unknown>,
      metadata: {},
    })

    await warmupRepo.insertNotification({
      configId,
      organizationId: orgId,
      notificationType: 'resumed',
      severity: 'info',
      title: 'Warmup Resumed',
      message: 'Warmup has been resumed',
      metadata: {},
    })

    const response = await buildResponse(updated, orgId)
    return successResult(response)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function restartWarmup(
  configId: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<WarmupConfigResponse>> {
  try {
    const config = await loadConfig(configId, orgId)
    if (!config) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const validation = validationService.validateCanRestartWarmup(config)
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    const previousStatus = config.status
    const updated = await warmupRepo.updateConfig(configId, orgId, {
      currentDay: 0,
      currentDailyTarget: 0,
      status: 'draft',
      stage: 'initial',
      health: 'healthy',
      startDate: null,
      endDate: null,
      pausedAt: null,
      resumedAt: null,
      graduatedAt: null,
      pauseReason: null,
      failureReason: null,
    })

    if (!updated) {
      return errorResult('DATABASE_FAILURE')
    }

    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'reset',
      previousStatus,
      newStatus: 'draft',
      previousStage: config.stage,
      newStage: 'initial',
      previousHealth: config.health,
      newHealth: 'healthy',
      message: 'Warmup reset to draft',
      metadata: {},
    })

    await warmupRepo.insertHistory({
      configId,
      organizationId: orgId,
      action: 'reset',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: { status: previousStatus, stage: config.stage, health: config.health } as Record<string, unknown>,
      newConfig: { status: 'draft', stage: 'initial', health: 'healthy', currentDay: 0 } as Record<string, unknown>,
      metadata: {},
    })

    await stageService.initializeStages(updated)
    await progressService.initializeDailyProgress(updated)

    const response = await buildResponse(updated, orgId)
    return successResult(response)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function graduateWarmup(
  configId: string,
  orgId: string,
  actor: ActorInfo,
  opts?: { force?: boolean }
): Promise<MailApiResult<WarmupConfigResponse>> {
  try {
    const config = await loadConfig(configId, orgId)
    if (!config) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const validation = validationService.validateCanGraduateWarmup(config, { force: opts?.force === true })
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    const previousStatus = config.status
    const now = new Date().toISOString()
    const updated = await warmupRepo.updateConfig(configId, orgId, {
      status: 'graduated',
      graduatedAt: now,
    })

    if (!updated) {
      return errorResult('DATABASE_FAILURE')
    }

    await statisticsService.recordGraduation(config, 'manual')

    await mailboxRepo.transitionMailboxStatus(config.mailboxId, orgId, 'connected').catch(() => {})
    const db = (await import('@/lib/db')).default
    await db.query(
      `UPDATE public.mail_mailboxes
       SET warmup_status = 'completed', mailbox_status = 'connected', updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [config.mailboxId, orgId]
    )

    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'graduated',
      previousStatus,
      newStatus: 'graduated',
      previousStage: config.stage,
      newStage: 'graduated',
      previousHealth: config.health,
      newHealth: config.health,
      message: 'Warmup graduated',
      metadata: { actor: actor.email },
    })

    await warmupRepo.insertHistory({
      configId,
      organizationId: orgId,
      action: 'graduated',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: { status: previousStatus } as Record<string, unknown>,
      newConfig: { status: 'graduated', graduatedAt: now } as Record<string, unknown>,
      metadata: {},
    })

    const response = await buildResponse(updated, orgId)
    return successResult(response)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function deleteWarmup(
  configId: string,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<boolean>> {
  try {
    const config = await loadConfig(configId, orgId)
    if (!config) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const validation = validationService.validateCanDeleteWarmup(config)
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'deleted',
      previousStatus: config.status,
      newStatus: null,
      previousStage: config.stage,
      newStage: null,
      previousHealth: config.health,
      newHealth: null,
      message: 'Warmup deleted',
      metadata: {},
    })

    await warmupRepo.insertHistory({
      configId,
      organizationId: orgId,
      action: 'deleted',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: config as unknown as Record<string, unknown>,
      newConfig: null,
      metadata: {},
    })

    const deleted = await warmupRepo.deleteConfig(configId, orgId)
    return successResult(deleted)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function updateWarmupConfig(
  configId: string,
  orgId: string,
  input: UpdateWarmupConfigRequest,
  actor: ActorInfo
): Promise<MailApiResult<WarmupConfigResponse>> {
  try {
    const config = await loadConfig(configId, orgId)
    if (!config) {
      return errorResult('WARMUP_NOT_FOUND')
    }

    const validation = validationService.validateCanUpdateWarmup(config)
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    const inputValidation = mailValidation.validateUpdateWarmupConfigRequest(input)
    if (!inputValidation.valid) {
      return errorResultRaw(inputValidation.errors.join('; '))
    }

    const updated = await warmupRepo.updateConfig(configId, orgId, {
      maxDailySends: input.maxDailySends,
      dailyIncrease: input.dailyIncrease,
      initialSends: input.initialSends,
      totalDays: input.totalDays,
      weekendSending: input.weekendSending,
      businessHoursStart: input.businessHoursStart,
      businessHoursEnd: input.businessHoursEnd,
      timezone: input.timezone,
      minDelayMs: input.minDelayMs,
      maxDelayMs: input.maxDelayMs,
      randomizationFactor: input.randomizationFactor,
      replySimulation: input.replySimulation,
      readSimulation: input.readSimulation,
      spamRescue: input.spamRescue,
      openSimulation: input.openSimulation,
      clickSimulation: input.clickSimulation,
      targetHealthScore: input.targetHealthScore,
      graduationThreshold: input.graduationThreshold,
      pauseThreshold: input.pauseThreshold,
      resumeThreshold: input.resumeThreshold,
      metadata: input.metadata,
    })

    if (!updated) {
      return errorResult('DATABASE_FAILURE')
    }

    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'updated',
      previousStatus: config.status,
      newStatus: updated.status,
      previousStage: config.stage,
      newStage: updated.stage,
      previousHealth: config.health,
      newHealth: updated.health,
      message: 'Warmup configuration updated',
      metadata: { changes: Object.keys(input) },
    })

    await warmupRepo.insertHistory({
      configId,
      organizationId: orgId,
      action: 'updated',
      actorUserId: actor.userId,
      actorEmail: actor.email,
      previousConfig: config as unknown as Record<string, unknown>,
      newConfig: updated as unknown as Record<string, unknown>,
      metadata: { changes: Object.keys(input) },
    })

    const response = await buildResponse(updated, orgId)
    return successResult(response)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function bulkOperation(
  request: WarmupBulkRequest,
  orgId: string,
  actor: ActorInfo
): Promise<MailApiResult<WarmupBulkResult[]>> {
  try {
    const configs: WarmupConfigModel[] = []
    for (const configId of request.configIds) {
      const config = await warmupRepo.findConfigById(configId, orgId)
      if (config) {
        configs.push(config)
      }
    }

    const validation = validationService.validateCanBulkOperation(configs, request.operation)
    if (!validation.valid) {
      return errorResultRaw(validation.errors.join('; '))
    }

    const results: WarmupBulkResult[] = []

    for (const config of configs) {
      try {
        switch (request.operation) {
          case 'pause': {
            const pauseValidation = validationService.validateCanPauseWarmup(config)
            if (!pauseValidation.valid) {
              results.push({ configId: config.id, success: false, error: pauseValidation.errors.join('; ') })
              break
            }
            const prevStatus = config.status
            await warmupRepo.updateConfig(config.id, orgId, {
              status: 'paused',
              pausedAt: new Date().toISOString(),
            })
            await warmupRepo.insertEvent({
              configId: config.id,
              organizationId: orgId,
              eventType: 'paused',
              previousStatus: prevStatus,
              newStatus: 'paused',
              message: 'Warmup paused via bulk operation',
              metadata: {},
            })
            await warmupRepo.insertHistory({
              configId: config.id,
              organizationId: orgId,
              action: 'paused',
              actorUserId: actor.userId,
              actorEmail: actor.email,
              previousConfig: { status: prevStatus } as Record<string, unknown>,
              newConfig: { status: 'paused' } as Record<string, unknown>,
              metadata: { bulk: true },
            })
            results.push({ configId: config.id, success: true })
            break
          }
          case 'resume': {
            const resumeValidation = validationService.validateCanResumeWarmup(config)
            if (!resumeValidation.valid) {
              results.push({ configId: config.id, success: false, error: resumeValidation.errors.join('; ') })
              break
            }
            const prevStatus = config.status
            await warmupRepo.updateConfig(config.id, orgId, {
              status: 'running',
              resumedAt: new Date().toISOString(),
              pauseReason: null,
            })
            await warmupRepo.insertEvent({
              configId: config.id,
              organizationId: orgId,
              eventType: 'resumed',
              previousStatus: prevStatus,
              newStatus: 'running',
              message: 'Warmup resumed via bulk operation',
              metadata: {},
            })
            await warmupRepo.insertHistory({
              configId: config.id,
              organizationId: orgId,
              action: 'resumed',
              actorUserId: actor.userId,
              actorEmail: actor.email,
              previousConfig: { status: prevStatus } as Record<string, unknown>,
              newConfig: { status: 'running' } as Record<string, unknown>,
              metadata: { bulk: true },
            })
            results.push({ configId: config.id, success: true })
            break
          }
          case 'archive':
          case 'delete': {
            const deleteValidation = validationService.validateCanDeleteWarmup(config)
            if (!deleteValidation.valid) {
              results.push({ configId: config.id, success: false, error: deleteValidation.errors.join('; ') })
              break
            }
            await warmupRepo.insertEvent({
              configId: config.id,
              organizationId: orgId,
              eventType: 'deleted',
              previousStatus: config.status,
              newStatus: null,
              message: `Warmup ${request.operation}d via bulk operation`,
              metadata: {},
            })
            await warmupRepo.insertHistory({
              configId: config.id,
              organizationId: orgId,
              action: request.operation,
              actorUserId: actor.userId,
              actorEmail: actor.email,
              previousConfig: config as unknown as Record<string, unknown>,
              newConfig: null,
              metadata: { bulk: true },
            })
            await warmupRepo.deleteConfig(config.id, orgId)
            results.push({ configId: config.id, success: true })
            break
          }
          default:
            results.push({ configId: config.id, success: false, error: `Unknown operation "${request.operation}"` })
        }
      } catch {
        results.push({ configId: config.id, success: false, error: 'Operation failed' })
      }
    }

    return successResult(results)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function getWarmupDashboard(orgId: string): Promise<WarmupDashboardStats> {
  try {
    return await warmupRepo.getDashboardStats(orgId)
  } catch {
    return {
      totalConfigs: 0,
      running: 0,
      paused: 0,
      graduated: 0,
      totalMailboxesWarming: 0,
      avgHealthScore: 0,
      graduationRate: 0,
    }
  }
}

export async function getWarmupDetails(
  configId: string,
  orgId: string
): Promise<MailApiResult<WarmupConfigWithStats>> {
  try {
    const result = await configurationService.getWarmupConfigWithStats(configId, orgId)
    if (!result) {
      return errorResult('WARMUP_NOT_FOUND')
    }
    return successResult(result)
  } catch {
    return errorResult('DATABASE_FAILURE')
  }
}

export async function listWarmups(
  orgId: string,
  params: {
    status?: string
    search?: string
    sortBy?: string
    sortDirection?: 'asc' | 'desc'
    page?: number
    pageSize?: number
  }
): Promise<{
  configs: WarmupConfigResponse[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const sortBy = params.sortBy ?? 'createdAt'
  const sortDirection = params.sortDirection ?? 'desc'
  const status = (params.status ?? 'all') as WarmupConfigStatus | 'all'
  const search = params.search ?? ''
  const offset = (page - 1) * pageSize

  const { configs, total } = await warmupRepo.findConfigsByStatusPaginated(
    orgId,
    status,
    search,
    sortBy,
    sortDirection,
    offset,
    pageSize
  )

  const responseConfigs: WarmupConfigResponse[] = []
  for (const config of configs) {
    const mailbox = await loadMailbox(config.mailboxId, orgId)
    responseConfigs.push(configToResponse(
      config,
      mailbox?.email ?? '',
      mailbox?.provider ?? ''
    ))
  }

  const totalPages = Math.ceil(total / pageSize)

  return {
    configs: responseConfigs,
    total,
    page,
    pageSize,
    totalPages,
  }
}

export async function getWarmupTemplates(orgId: string) {
  return configurationService.listWarmupTemplates(orgId)
}
