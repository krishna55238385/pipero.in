import type { WarmupHealth, WarmupConfigModel, WarmupDailyStats } from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'

export function calculateHealthScore(stats: WarmupDailyStats[]): number {
  if (stats.length === 0) return 50

  const totals = stats.reduce(
    (acc, s) => ({
      actual: acc.actual + s.actualSends,
      successful: acc.successful + s.successfulSends,
      bounced: acc.bounced + s.bouncedSends,
      spam: acc.spam + s.spamReports,
    }),
    { actual: 0, successful: 0, bounced: 0, spam: 0 },
  )

  if (totals.actual === 0) return 50

  const deliveryRate = totals.successful / totals.actual
  const bounceRate = totals.bounced / totals.actual
  const spamRate = totals.spam / totals.actual

  let score = 70
  score += deliveryRate * 20
  score -= bounceRate * 100
  score -= spamRate * 200

  return Math.max(0, Math.min(100, Math.round(score)))
}

export function scoreToHealth(score: number): WarmupHealth {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'healthy'
  if (score >= 40) return 'warning'
  return 'critical'
}

export async function evaluateHealthChange(
  configId: string,
  orgId: string,
): Promise<{ changed: boolean; previousHealth: WarmupHealth; newHealth: WarmupHealth; healthScore: number }> {
  const config = await warmupRepo.findConfigById(configId, orgId)
  if (!config) {
    return { changed: false, previousHealth: 'critical', newHealth: 'critical', healthScore: 0 }
  }

  const allStats = await warmupRepo.findStatsByConfigId(configId)
  const recentStats = allStats.slice(-7)
  const healthScore = calculateHealthScore(recentStats)
  const newHealth = scoreToHealth(healthScore)
  const previousHealth = config.health
  const changed = previousHealth !== newHealth

  if (changed) {
    await warmupRepo.insertEvent({
      configId,
      organizationId: orgId,
      eventType: 'health_changed',
      previousHealth,
      newHealth,
      message: `Health changed from ${previousHealth} to ${newHealth} (score: ${healthScore})`,
      metadata: { healthScore },
    })

    await warmupRepo.updateConfig(configId, orgId, { health: newHealth })
  }

  if (newHealth === 'critical') {
    await warmupRepo.insertNotification({
      configId,
      organizationId: orgId,
      notificationType: 'health_critical',
      severity: 'critical',
      title: 'Warmup health is critical',
      message: `Health score dropped to ${healthScore}. Immediate attention required.`,
      metadata: { healthScore, previousHealth },
    })
  } else if (newHealth === 'warning') {
    await warmupRepo.insertNotification({
      configId,
      organizationId: orgId,
      notificationType: 'health_warning',
      severity: 'warning',
      title: 'Warmup health warning',
      message: `Health score is ${healthScore}. Monitor sending reputation closely.`,
      metadata: { healthScore, previousHealth },
    })
  }

  return { changed, previousHealth, newHealth, healthScore }
}

export async function getHealthTrend(
  configId: string,
  days: number = 7,
): Promise<{ date: string; healthScore: number }[]> {
  const allStats = await warmupRepo.findStatsByConfigId(configId)
  const recentStats = allStats.slice(-days)

  return recentStats.map((s) => ({
    date: s.date,
    healthScore: s.healthScore ?? calculateHealthScore([s]),
  }))
}

export async function checkGraduationReadiness(
  config: WarmupConfigModel,
): Promise<{ ready: boolean; reasons: string[] }> {
  const reasons: string[] = []
  const stats = await warmupRepo.findStatsByConfigId(config.id)
  const recentStats = stats.slice(-7)
  const healthScore = calculateHealthScore(recentStats)

  if (healthScore < config.graduationThreshold) {
    reasons.push(`Health score ${healthScore} is below graduation threshold ${config.graduationThreshold}`)
  }

  if (config.currentDay < config.totalDays) {
    reasons.push(`Current day ${config.currentDay} has not reached total days ${config.totalDays}`)
  }

  if (recentStats.length > 0) {
    const totals = recentStats.reduce(
      (acc, s) => ({ actual: acc.actual + s.actualSends, bounced: acc.bounced + s.bouncedSends }),
      { actual: 0, bounced: 0 },
    )

    if (totals.actual > 0) {
      const bounceRate = (totals.bounced / totals.actual) * 100
      if (bounceRate >= 5) {
        reasons.push(`Recent bounce rate ${bounceRate.toFixed(1)}% exceeds 5% threshold`)
      }
    }
  }

  return { ready: reasons.length === 0, reasons }
}
