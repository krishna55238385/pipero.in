import type {
  CreateWarmupConfigRequest,
  UpdateWarmupConfigRequest,
  WarmupConfigModel,
  WarmupConfigResponse,
  WarmupConfigWithStats,
  WarmupTemplate,
  Mailbox,
  MailApiResult,
} from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import * as mailValidation from '@/lib/mail-validation'

const DEFAULT_WARMUP = {
  maxDailySends: 20,
  dailyIncrease: 2,
  initialSends: 5,
  totalDays: 30,
  weekendSending: false,
  businessHoursStart: 9,
  businessHoursEnd: 17,
  timezone: 'UTC',
  minDelayMs: 30000,
  maxDelayMs: 120000,
  randomizationFactor: 0.3,
  replySimulation: true,
  readSimulation: true,
  spamRescue: true,
  openSimulation: true,
  clickSimulation: false,
  targetHealthScore: 80,
  graduationThreshold: 75,
  pauseThreshold: 30,
  resumeThreshold: 50,
}

function templateToDefaults(template: WarmupTemplate): typeof DEFAULT_WARMUP {
  return {
    maxDailySends: template.maxDailySends,
    dailyIncrease: template.dailyIncrease,
    initialSends: template.initialSends,
    totalDays: template.totalDays,
    weekendSending: template.weekendSending,
    businessHoursStart: template.businessHoursStart,
    businessHoursEnd: template.businessHoursEnd,
    timezone: template.timezone,
    minDelayMs: template.minDelayMs,
    maxDelayMs: template.maxDelayMs,
    randomizationFactor: template.randomizationFactor,
    replySimulation: template.replySimulation,
    readSimulation: template.readSimulation,
    spamRescue: template.spamRescue,
    openSimulation: template.openSimulation,
    clickSimulation: template.clickSimulation,
    targetHealthScore: template.targetHealthScore,
    graduationThreshold: template.graduationThreshold,
    pauseThreshold: template.pauseThreshold,
    resumeThreshold: template.resumeThreshold,
  }
}

export async function buildWarmupConfigFromRequest(
  orgId: string,
  input: CreateWarmupConfigRequest
): Promise<WarmupConfigModel> {
  const validation = mailValidation.validateCreateWarmupConfigRequest(input)
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.errors.join('; ')}`)
  }

  let defaults = { ...DEFAULT_WARMUP }

  if (input.templateId) {
    const template = await warmupRepo.findTemplateById(input.templateId, orgId)
    if (template) {
      defaults = templateToDefaults(template)
    }
  } else {
    const defaultTemplate = await warmupRepo.findDefaultTemplate(orgId)
    if (defaultTemplate) {
      defaults = templateToDefaults(defaultTemplate)
    }
  }

  const config = await warmupRepo.insertConfig(orgId, {
    mailboxId: input.mailboxId,
    status: 'draft',
    stage: 'initial',
    health: 'healthy',
    startDate: input.startDate ?? null,
    initialSends: input.initialSends ?? defaults.initialSends,
    maxDailySends: input.maxDailySends ?? defaults.maxDailySends,
    dailyIncrease: input.dailyIncrease ?? defaults.dailyIncrease,
    currentDailyTarget: 0,
    totalDays: input.totalDays ?? defaults.totalDays,
    weekendSending: input.weekendSending ?? defaults.weekendSending,
    businessHoursStart: input.businessHoursStart ?? defaults.businessHoursStart,
    businessHoursEnd: input.businessHoursEnd ?? defaults.businessHoursEnd,
    timezone: input.timezone ?? defaults.timezone,
    minDelayMs: input.minDelayMs ?? defaults.minDelayMs,
    maxDelayMs: input.maxDelayMs ?? defaults.maxDelayMs,
    randomizationFactor: input.randomizationFactor ?? defaults.randomizationFactor,
    replySimulation: input.replySimulation ?? defaults.replySimulation,
    readSimulation: input.readSimulation ?? defaults.readSimulation,
    spamRescue: input.spamRescue ?? defaults.spamRescue,
    openSimulation: input.openSimulation ?? defaults.openSimulation,
    clickSimulation: input.clickSimulation ?? defaults.clickSimulation,
    targetHealthScore: input.targetHealthScore ?? defaults.targetHealthScore,
    graduationThreshold: input.graduationThreshold ?? defaults.graduationThreshold,
    pauseThreshold: input.pauseThreshold ?? defaults.pauseThreshold,
    resumeThreshold: input.resumeThreshold ?? defaults.resumeThreshold,
    metadata: input.metadata ?? {},
  })

  return config
}

export function toWarmupConfigResponse(
  config: WarmupConfigModel,
  mailbox: Mailbox
): WarmupConfigResponse {
  return {
    id: config.id,
    organizationId: config.organizationId,
    mailboxId: config.mailboxId,
    mailboxEmail: mailbox.email,
    mailboxProvider: mailbox.provider,
    status: config.status,
    stage: config.stage,
    health: config.health,
    startDate: config.startDate,
    endDate: config.endDate,
    currentDay: config.currentDay,
    totalDays: config.totalDays,
    initialSends: config.initialSends,
    maxDailySends: config.maxDailySends,
    dailyIncrease: config.dailyIncrease,
    currentDailyTarget: config.currentDailyTarget,
    weekendSending: config.weekendSending,
    businessHoursStart: config.businessHoursStart,
    businessHoursEnd: config.businessHoursEnd,
    timezone: config.timezone,
    minDelayMs: config.minDelayMs,
    maxDelayMs: config.maxDelayMs,
    randomizationFactor: config.randomizationFactor,
    replySimulation: config.replySimulation,
    readSimulation: config.readSimulation,
    spamRescue: config.spamRescue,
    openSimulation: config.openSimulation,
    clickSimulation: config.clickSimulation,
    targetHealthScore: config.targetHealthScore,
    graduationThreshold: config.graduationThreshold,
    pauseThreshold: config.pauseThreshold,
    resumeThreshold: config.resumeThreshold,
    pauseReason: config.pauseReason,
    failureReason: config.failureReason,
    metadata: config.metadata,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  }
}

export async function getWarmupConfigWithStats(
  configId: string,
  orgId: string
): Promise<WarmupConfigWithStats | null> {
  const config = await warmupRepo.findConfigById(configId, orgId)
  if (!config) return null

  const mailbox = await mailboxRepo.findMailboxById(config.mailboxId, orgId)
  if (!mailbox) return null

  const response = toWarmupConfigResponse(config, mailbox)

  const [todayStats, recentEvents, activeNotifications] = await Promise.all([
    warmupRepo.findTodayStats(configId),
    warmupRepo.findEventsByConfigId(configId, 10),
    warmupRepo.countUnreadNotifications(configId),
  ])

  return {
    ...response,
    todayStats,
    recentEvents,
    activeNotifications,
  }
}

export async function listWarmupConfigs(orgId: string): Promise<WarmupConfigResponse[]> {
  const configs = await warmupRepo.findConfigsByOrg(orgId)
  const responses: WarmupConfigResponse[] = []

  for (const config of configs) {
    const mailbox = await mailboxRepo.findMailboxById(config.mailboxId, orgId)
    if (mailbox) {
      responses.push(toWarmupConfigResponse(config, mailbox))
    }
  }

  return responses
}

export async function listWarmupTemplates(orgId: string): Promise<WarmupTemplate[]> {
  return warmupRepo.findTemplatesByOrg(orgId)
}

export async function createWarmupTemplate(
  orgId: string,
  data: {
    name: string
    description: string
    isDefault?: boolean
    maxDailySends?: number
    dailyIncrease?: number
    initialSends?: number
    totalDays?: number
    weekendSending?: boolean
    businessHoursStart?: number
    businessHoursEnd?: number
    timezone?: string
    minDelayMs?: number
    maxDelayMs?: number
    randomizationFactor?: number
    replySimulation?: boolean
    readSimulation?: boolean
    spamRescue?: boolean
    openSimulation?: boolean
    clickSimulation?: boolean
    targetHealthScore?: number
    graduationThreshold?: number
    pauseThreshold?: number
    resumeThreshold?: number
    metadata?: Record<string, unknown>
  }
): Promise<WarmupTemplate> {
  return warmupRepo.insertTemplate(orgId, {
    name: data.name,
    description: data.description,
    isDefault: data.isDefault ?? false,
    maxDailySends: data.maxDailySends ?? DEFAULT_WARMUP.maxDailySends,
    dailyIncrease: data.dailyIncrease ?? DEFAULT_WARMUP.dailyIncrease,
    initialSends: data.initialSends ?? DEFAULT_WARMUP.initialSends,
    totalDays: data.totalDays ?? DEFAULT_WARMUP.totalDays,
    weekendSending: data.weekendSending ?? DEFAULT_WARMUP.weekendSending,
    businessHoursStart: data.businessHoursStart ?? DEFAULT_WARMUP.businessHoursStart,
    businessHoursEnd: data.businessHoursEnd ?? DEFAULT_WARMUP.businessHoursEnd,
    timezone: data.timezone ?? DEFAULT_WARMUP.timezone,
    minDelayMs: data.minDelayMs ?? DEFAULT_WARMUP.minDelayMs,
    maxDelayMs: data.maxDelayMs ?? DEFAULT_WARMUP.maxDelayMs,
    randomizationFactor: data.randomizationFactor ?? DEFAULT_WARMUP.randomizationFactor,
    replySimulation: data.replySimulation ?? DEFAULT_WARMUP.replySimulation,
    readSimulation: data.readSimulation ?? DEFAULT_WARMUP.readSimulation,
    spamRescue: data.spamRescue ?? DEFAULT_WARMUP.spamRescue,
    openSimulation: data.openSimulation ?? DEFAULT_WARMUP.openSimulation,
    clickSimulation: data.clickSimulation ?? DEFAULT_WARMUP.clickSimulation,
    targetHealthScore: data.targetHealthScore ?? DEFAULT_WARMUP.targetHealthScore,
    graduationThreshold: data.graduationThreshold ?? DEFAULT_WARMUP.graduationThreshold,
    pauseThreshold: data.pauseThreshold ?? DEFAULT_WARMUP.pauseThreshold,
    resumeThreshold: data.resumeThreshold ?? DEFAULT_WARMUP.resumeThreshold,
    metadata: data.metadata ?? {},
  })
}

export async function deleteWarmupTemplate(
  id: string,
  orgId: string
): Promise<MailApiResult<boolean>> {
  const template = await warmupRepo.findTemplateById(id, orgId)
  if (!template) {
    return { success: false, error: 'Template not found' }
  }
  if (template.isDefault) {
    return { success: false, error: 'Cannot delete the default template' }
  }
  const deleted = await warmupRepo.deleteTemplate(id, orgId)
  return { success: true, data: deleted }
}
