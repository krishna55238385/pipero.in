import type {
  WarmupConfigModel,
  WarmupDailyStats,
} from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'

import { calculateDailyTarget as calcStageDailyTarget } from './warmup-stage-service'

export function calculateDailyTarget(
  day: number,
  config: { initialSends: number; dailyIncrease: number; maxDailySends: number }
): number {
  return calcStageDailyTarget(day, config)
}

export function isWeekend(date?: Date): boolean {
  const d = date ?? new Date()
  const day = d.getDay()
  return day === 0 || day === 6
}

export function shouldSendToday(config: WarmupConfigModel, now?: Date): boolean {
  if (!config.weekendSending && isWeekend(now)) {
    return false
  }
  return true
}

export async function initializeDailyProgress(
  config: WarmupConfigModel
): Promise<WarmupDailyStats> {
  const target = calculateDailyTarget(1, config)
  const today = new Date().toISOString().split('T')[0]

  return warmupRepo.upsertDailyStats({
    configId: config.id,
    organizationId: config.organizationId,
    date: today,
    dayNumber: 1,
    targetSends: target,
    actualSends: 0,
    successfulSends: 0,
    failedSends: 0,
    bouncedSends: 0,
    repliesReceived: 0,
    opensTracked: 0,
    clicksTracked: 0,
    spamReports: 0,
  })
}

export async function recordSendOutcome(
  configId: string,
  orgId: string,
  date: string,
  outcome: {
    sent: boolean
    successful: boolean
    bounced: boolean
    replied: boolean
    opened: boolean
    clicked: boolean
    spamReport: boolean
  }
): Promise<WarmupDailyStats> {
  let stats = await warmupRepo.findTodayStats(configId)

  if (!stats) {
    const config = await warmupRepo.findConfigById(configId, orgId)
    if (!config) throw new Error('Config not found')
    stats = await warmupRepo.upsertDailyStats({
      configId,
      organizationId: orgId,
      date,
      dayNumber: config.currentDay || 1,
      targetSends: config.currentDailyTarget,
    })
  }

  const updated = await warmupRepo.upsertDailyStats({
    configId,
    organizationId: orgId,
    date,
    dayNumber: stats.dayNumber,
    targetSends: stats.targetSends,
    actualSends: stats.actualSends + (outcome.sent ? 1 : 0),
    successfulSends: stats.successfulSends + (outcome.successful ? 1 : 0),
    failedSends: stats.failedSends + (outcome.sent && !outcome.successful ? 1 : 0),
    bouncedSends: stats.bouncedSends + (outcome.bounced ? 1 : 0),
    repliesReceived: stats.repliesReceived + (outcome.replied ? 1 : 0),
    opensTracked: stats.opensTracked + (outcome.opened ? 1 : 0),
    clicksTracked: stats.clicksTracked + (outcome.clicked ? 1 : 0),
    spamReports: stats.spamReports + (outcome.spamReport ? 1 : 0),
  })

  const config = await warmupRepo.findConfigById(configId, orgId)
  if (config) {
    const stage = await warmupRepo.findStageByConfigAndDay(configId, config.currentDay)
    if (stage) {
      await warmupRepo.updateStage(configId, config.currentDay, {
        actualSends: updated.actualSends,
        successCount: updated.successfulSends,
        failureCount: updated.failedSends,
        bounceCount: updated.bouncedSends,
      })
    }
  }

  return updated
}

export async function advanceDay(
  config: WarmupConfigModel
): Promise<{ newDay: number; newTarget: number }> {
  const newDay = config.currentDay + 1
  const newTarget = calculateDailyTarget(newDay, config)

  await warmupRepo.updateConfig(config.id, config.organizationId, {
    currentDay: newDay,
    currentDailyTarget: newTarget,
  })

  return { newDay, newTarget }
}

export async function getProgressSummary(
  configId: string,
  orgId: string
): Promise<{
  currentDay: number
  totalDays: number
  progressPercent: number
  totalSent: number
  totalSuccessful: number
  totalBounced: number
  avgDailyActual: number
}> {
  const config = await warmupRepo.findConfigById(configId, orgId)
  if (!config) throw new Error('Config not found')

  const stats = await warmupRepo.findStatsByConfigId(configId)

  const totalSent = stats.reduce((sum, s) => sum + s.actualSends, 0)
  const totalSuccessful = stats.reduce((sum, s) => sum + s.successfulSends, 0)
  const totalBounced = stats.reduce((sum, s) => sum + s.bouncedSends, 0)
  const avgDailyActual = stats.length > 0 ? Math.round(totalSent / stats.length) : 0
  const progressPercent = config.totalDays > 0
    ? Math.round((config.currentDay / config.totalDays) * 100)
    : 0

  return {
    currentDay: config.currentDay,
    totalDays: config.totalDays,
    progressPercent,
    totalSent,
    totalSuccessful,
    totalBounced,
    avgDailyActual,
  }
}

export async function getRecentStats(
  configId: string,
  days: number = 7
): Promise<WarmupDailyStats[]> {
  const allStats = await warmupRepo.findStatsByConfigId(configId)
  return allStats.slice(0, days)
}
