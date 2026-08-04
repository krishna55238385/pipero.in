import type {
  WarmupConfigModel,
  WarmupDailyStats,
  WarmupGraduation,
  WarmupDashboardStats,
  WarmupNotification,
  MailApiResult,
} from '@/types/mail'
import * as warmupRepo from '@/repositories/mail/warmup-repository'

export async function getDashboardOverview(orgId: string): Promise<
  WarmupDashboardStats & {
    recentGraduations: WarmupGraduation[]
    totalEventsToday: number
  }
> {
  const stats = await warmupRepo.getDashboardStats(orgId)
  const recentGraduations = await warmupRepo.findGraduationsByOrg(orgId, 5)

  const configs = await warmupRepo.findConfigsByOrg(orgId)
  let totalEventsToday = 0
  const today = new Date().toISOString().split('T')[0]

  for (const config of configs) {
    const events = await warmupRepo.findEventsByConfigId(config.id, 100)
    for (const event of events) {
      if (event.createdAt.startsWith(today)) {
        totalEventsToday++
      }
    }
  }

  return {
    ...stats,
    recentGraduations,
    totalEventsToday,
  }
}

export async function getConfigStatistics(
  configId: string,
  orgId: string
): Promise<{
  totalSent: number
  totalSuccessful: number
  totalFailed: number
  totalBounced: number
  totalReplies: number
  totalOpens: number
  totalClicks: number
  totalSpamReports: number
  avgDeliveryRate: number
  avgBounceRate: number
  avgSpamRate: number
  healthTrend: { date: string; score: number }[]
}> {
  const stats = await warmupRepo.findStatsByConfigId(configId)

  const totalSent = stats.reduce((sum, s) => sum + s.actualSends, 0)
  const totalSuccessful = stats.reduce((sum, s) => sum + s.successfulSends, 0)
  const totalFailed = stats.reduce((sum, s) => sum + s.failedSends, 0)
  const totalBounced = stats.reduce((sum, s) => sum + s.bouncedSends, 0)
  const totalReplies = stats.reduce((sum, s) => sum + s.repliesReceived, 0)
  const totalOpens = stats.reduce((sum, s) => sum + s.opensTracked, 0)
  const totalClicks = stats.reduce((sum, s) => sum + s.clicksTracked, 0)
  const totalSpamReports = stats.reduce((sum, s) => sum + s.spamReports, 0)

  const avgDeliveryRate = totalSent > 0 ? Math.round((totalSuccessful / totalSent) * 100) : 0
  const avgBounceRate = totalSent > 0 ? Math.round((totalBounced / totalSent) * 100) : 0
  const avgSpamRate = totalSent > 0 ? Math.round((totalSpamReports / totalSent) * 100) : 0

  const healthTrend = stats
    .filter(s => s.healthScore !== null)
    .map(s => ({ date: s.date, score: s.healthScore! }))
    .reverse()

  return {
    totalSent,
    totalSuccessful,
    totalFailed,
    totalBounced,
    totalReplies,
    totalOpens,
    totalClicks,
    totalSpamReports,
    avgDeliveryRate,
    avgBounceRate,
    avgSpamRate,
    healthTrend,
  }
}

export async function recordGraduation(
  config: WarmupConfigModel,
  reason: string
): Promise<WarmupGraduation> {
  const stats = await warmupRepo.findStatsByConfigId(config.id)

  const totalSends = stats.reduce((sum, s) => sum + s.actualSends, 0)
  const totalSuccessful = stats.reduce((sum, s) => sum + s.successfulSends, 0)
  const totalBounced = stats.reduce((sum, s) => sum + s.bouncedSends, 0)

  const lastStat = stats[0]
  const finalHealthScore = lastStat?.healthScore ?? 50
  const finalReputationScore = lastStat?.reputationScore ?? null

  const graduation = await warmupRepo.insertGraduation({
    configId: config.id,
    organizationId: config.organizationId,
    mailboxId: config.mailboxId,
    finalHealthScore,
    finalReputationScore,
    totalDays: config.currentDay,
    totalSends,
    totalSuccessful,
    totalBounced,
    graduationReason: reason,
  })

  await warmupRepo.insertEvent({
    configId: config.id,
    organizationId: config.organizationId,
    eventType: 'graduated',
    previousStatus: config.status,
    newStatus: 'graduated',
    previousStage: config.stage,
    newStage: 'graduated',
    message: `Warmup graduated: ${reason}`,
  })

  await warmupRepo.insertNotification({
    configId: config.id,
    organizationId: config.organizationId,
    notificationType: 'graduated',
    severity: 'info',
    title: 'Warmup Graduated',
    message: `Warmup has graduated successfully. Final health score: ${finalHealthScore}`,
  })

  return graduation
}

export async function getOrganizationWarmupStats(orgId: string): Promise<{
  totalMailboxesWarming: number
  avgHealthScore: number
  totalSentAllTime: number
  graduationRate: number
  topPerformers: { configId: string; mailboxId: string; healthScore: number }[]
}> {
  const allConfigs = await warmupRepo.findConfigsByOrg(orgId)
  const runningConfigs = allConfigs.filter(c => c.status === 'running' || c.status === 'paused')

  let totalHealthScore = 0
  let healthCount = 0
  let totalSentAllTime = 0
  const performers: { configId: string; mailboxId: string; healthScore: number }[] = []

  for (const config of runningConfigs) {
    const stats = await warmupRepo.findStatsByConfigId(config.id)
    const sent = stats.reduce((sum, s) => sum + s.actualSends, 0)
    totalSentAllTime += sent

    const lastStat = stats[0]
    if (lastStat?.healthScore !== null && lastStat?.healthScore !== undefined) {
      totalHealthScore += lastStat.healthScore
      healthCount++
      performers.push({
        configId: config.id,
        mailboxId: config.mailboxId,
        healthScore: lastStat.healthScore,
      })
    }
  }

  const graduated = allConfigs.filter(c => c.status === 'graduated').length
  const graduationRate = allConfigs.length > 0
    ? Math.round((graduated / allConfigs.length) * 100)
    : 0

  performers.sort((a, b) => b.healthScore - a.healthScore)

  return {
    totalMailboxesWarming: runningConfigs.length,
    avgHealthScore: healthCount > 0 ? Math.round(totalHealthScore / healthCount) : 0,
    totalSentAllTime,
    graduationRate,
    topPerformers: performers.slice(0, 10),
  }
}

export async function getNotifications(
  configId: string
): Promise<{ unread: number; notifications: WarmupNotification[] }> {
  const unread = await warmupRepo.countUnreadNotifications(configId)
  const notifications = await warmupRepo.findUnreadNotifications(configId)
  return { unread, notifications }
}

export async function markNotificationsRead(
  configId: string,
  notificationIds?: string[]
): Promise<number> {
  if (notificationIds && notificationIds.length > 0) {
    let count = 0
    for (const id of notificationIds) {
      const marked = await warmupRepo.markNotificationRead(id)
      if (marked) count++
    }
    return count
  }
  return warmupRepo.markAllNotificationsRead(configId)
}
