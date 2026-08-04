import type { WarmupStage, WarmupConfigModel } from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'

export function calculateStageForDay(currentDay: number, totalDays: number): WarmupStage {
  if (currentDay >= totalDays) return 'graduated'
  if (currentDay >= 46) return 'established'
  if (currentDay >= 22) return 'growing'
  if (currentDay >= 8) return 'learning'
  return 'initial'
}

export function shouldAdvanceStage(
  currentDay: number,
  totalDays: number,
  currentStage: WarmupStage
): boolean {
  return calculateStageForDay(currentDay, totalDays) !== currentStage
}

/** PRD §6.3 / §14 — day 1 and each stage start capped at ≤5 sends/day */
export const WARMUP_RAMP_DAY_CAP = 5
const STAGE_START_DAYS = new Set([1, 8, 22, 46])

export function isWarmupStageStartDay(day: number): boolean {
  return day === 1 || STAGE_START_DAYS.has(day)
}

export function enforceWarmupDailyCap(day: number, target: number): number {
  if (isWarmupStageStartDay(day)) {
    return Math.min(target, WARMUP_RAMP_DAY_CAP)
  }
  return target
}

export function calculateDailyTarget(
  day: number,
  config: { initialSends: number; dailyIncrease: number; maxDailySends: number }
): number {
  const raw = Math.min(config.initialSends + (day - 1) * config.dailyIncrease, config.maxDailySends)
  return enforceWarmupDailyCap(day, raw)
}

export async function initializeStages(config: WarmupConfigModel): Promise<void> {
  for (let day = 1; day <= config.totalDays; day++) {
    const existing = await warmupRepo.findStageByConfigAndDay(config.id, day)
    if (existing) continue

    await warmupRepo.insertStage({
      configId: config.id,
      organizationId: config.organizationId,
      stage: calculateStageForDay(day, config.totalDays),
      dayNumber: day,
      targetSends: calculateDailyTarget(day, config),
    })
  }
}

export async function advanceStageIfNeeded(
  config: WarmupConfigModel
): Promise<{ advanced: boolean; newStage?: WarmupStage }> {
  const nextStage = calculateStageForDay(config.currentDay, config.totalDays)

  if (!shouldAdvanceStage(config.currentDay, config.totalDays, config.stage)) {
    return { advanced: false }
  }

  await warmupRepo.updateStage(config.id, config.currentDay - 1, {
    completedAt: new Date().toISOString(),
  })

  await warmupRepo.insertStage({
    configId: config.id,
    organizationId: config.organizationId,
    stage: nextStage,
    dayNumber: config.currentDay,
    targetSends: calculateDailyTarget(config.currentDay, config),
  })

  await warmupRepo.updateConfig(config.id, config.organizationId, { stage: nextStage })

  return { advanced: true, newStage: nextStage }
}

export async function getStageProgress(
  config: WarmupConfigModel
): Promise<{
  currentStage: WarmupStage
  stagesCompleted: number
  totalStages: number
  currentStageDay: number
  daysInStage: number
}> {
  const stages = await warmupRepo.findStagesByConfigId(config.id)
  const stagesCompleted = stages.filter((s) => s.completedAt !== null).length

  const stageStart = getStageStartDay(config.stage)
  const stageEnd = getStageEndDay(config.stage, config.totalDays)
  const currentStageDay = config.currentDay - stageStart + 1
  const daysInStage = stageEnd - stageStart + 1

  return {
    currentStage: config.stage,
    stagesCompleted,
    totalStages: stages.length,
    currentStageDay: Math.max(currentStageDay, 1),
    daysInStage,
  }
}

function getStageStartDay(stage: WarmupStage): number {
  switch (stage) {
    case 'initial': return 1
    case 'learning': return 8
    case 'growing': return 22
    case 'established': return 46
    case 'graduated': return Infinity
  }
}

function getStageEndDay(stage: WarmupStage, totalDays: number): number {
  switch (stage) {
    case 'initial': return 7
    case 'learning': return 21
    case 'growing': return 45
    case 'established': return totalDays - 1
    case 'graduated': return totalDays
  }
}
