import pool from '@/lib/db'
import type {
  WarmupConfigModel,
  WarmupConfigStatus,
  WarmupStage,
  WarmupHealth,
  WarmupStageModel,
  WarmupDailyStats,
  WarmupEvent,
  WarmupHistoryEntry,
  WarmupTemplate,
  WarmupException,
  WarmupGraduation,
  WarmupNotification,
  WarmupEventType,
  WarmupExceptionType,
  WarmupNotificationType,
} from '@/types/mail'

// ============================================================
// Row Types
// ============================================================

type WarmupConfigRow = {
  id: string
  organization_id: string
  mailbox_id: string
  status: WarmupConfigStatus
  stage: WarmupStage
  health: WarmupHealth
  start_date: string | null
  end_date: string | null
  paused_at: string | null
  resumed_at: string | null
  graduated_at: string | null
  current_day: number
  total_days: number
  initial_sends: number
  max_daily_sends: number
  daily_increase: number
  current_daily_target: number
  weekend_sending: boolean
  business_hours_start: number
  business_hours_end: number
  timezone: string
  min_delay_ms: number
  max_delay_ms: number
  randomization_factor: number
  reply_simulation: boolean
  read_simulation: boolean
  spam_rescue: boolean
  open_simulation: boolean
  click_simulation: boolean
  target_health_score: number
  graduation_threshold: number
  pause_threshold: number
  resume_threshold: number
  pause_reason: string | null
  failure_reason: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

type WarmupStageRow = {
  id: string
  config_id: string
  organization_id: string
  stage: WarmupStage
  day_number: number
  target_sends: number
  actual_sends: number
  success_count: number
  failure_count: number
  bounce_count: number
  health_score: number | null
  reputation_score: number | null
  started_at: string | null
  completed_at: string | null
  metadata: Record<string, unknown>
  created_at: string
}

type WarmupDailyStatsRow = {
  id: string
  config_id: string
  organization_id: string
  date: string
  day_number: number
  target_sends: number
  actual_sends: number
  successful_sends: number
  failed_sends: number
  bounced_sends: number
  replies_received: number
  opens_tracked: number
  clicks_tracked: number
  spam_reports: number
  health_score: number | null
  reputation_score: number | null
  metadata: Record<string, unknown>
  created_at: string
}

type WarmupEventRow = {
  id: string
  config_id: string
  organization_id: string
  event_type: WarmupEventType
  previous_status: string | null
  new_status: string | null
  previous_stage: string | null
  new_stage: string | null
  previous_health: string | null
  new_health: string | null
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

type WarmupHistoryRow = {
  id: string
  config_id: string
  organization_id: string
  action: string
  actor_user_id: string
  actor_email: string
  previous_config: Record<string, unknown> | null
  new_config: Record<string, unknown> | null
  metadata: Record<string, unknown>
  created_at: string
}

type WarmupTemplateRow = {
  id: string
  organization_id: string
  name: string
  description: string
  is_default: boolean
  max_daily_sends: number
  daily_increase: number
  initial_sends: number
  total_days: number
  weekend_sending: boolean
  business_hours_start: number
  business_hours_end: number
  timezone: string
  min_delay_ms: number
  max_delay_ms: number
  randomization_factor: number
  reply_simulation: boolean
  read_simulation: boolean
  spam_rescue: boolean
  open_simulation: boolean
  click_simulation: boolean
  target_health_score: number
  graduation_threshold: number
  pause_threshold: number
  resume_threshold: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

type WarmupExceptionRow = {
  id: string
  config_id: string
  organization_id: string
  exception_type: WarmupExceptionType
  day_number: number
  reason: string
  volume_modifier: number | null
  is_applied: boolean
  metadata: Record<string, unknown>
  created_at: string
}

type WarmupGraduationRow = {
  id: string
  config_id: string
  organization_id: string
  mailbox_id: string
  final_health_score: number
  final_reputation_score: number | null
  total_days: number
  total_sends: number
  total_successful: number
  total_bounced: number
  graduation_reason: string
  metadata: Record<string, unknown>
  graduated_at: string
  created_at: string
}

type WarmupNotificationRow = {
  id: string
  config_id: string
  organization_id: string
  notification_type: WarmupNotificationType
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  is_read: boolean
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapConfigRow(row: WarmupConfigRow): WarmupConfigModel {
  return {
    id: row.id,
    organizationId: row.organization_id,
    mailboxId: row.mailbox_id,
    status: row.status,
    stage: row.stage,
    health: row.health,
    startDate: row.start_date,
    endDate: row.end_date,
    pausedAt: row.paused_at,
    resumedAt: row.resumed_at,
    graduatedAt: row.graduated_at,
    currentDay: row.current_day,
    totalDays: row.total_days,
    initialSends: row.initial_sends,
    maxDailySends: row.max_daily_sends,
    dailyIncrease: row.daily_increase,
    currentDailyTarget: row.current_daily_target,
    weekendSending: row.weekend_sending,
    businessHoursStart: row.business_hours_start,
    businessHoursEnd: row.business_hours_end,
    timezone: row.timezone,
    minDelayMs: row.min_delay_ms,
    maxDelayMs: row.max_delay_ms,
    randomizationFactor: row.randomization_factor,
    replySimulation: row.reply_simulation,
    readSimulation: row.read_simulation,
    spamRescue: row.spam_rescue,
    openSimulation: row.open_simulation,
    clickSimulation: row.click_simulation,
    targetHealthScore: row.target_health_score,
    graduationThreshold: row.graduation_threshold,
    pauseThreshold: row.pause_threshold,
    resumeThreshold: row.resume_threshold,
    pauseReason: row.pause_reason,
    failureReason: row.failure_reason,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapStageRow(row: WarmupStageRow): WarmupStageModel {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    stage: row.stage,
    dayNumber: row.day_number,
    targetSends: row.target_sends,
    actualSends: row.actual_sends,
    successCount: row.success_count,
    failureCount: row.failure_count,
    bounceCount: row.bounce_count,
    healthScore: row.health_score,
    reputationScore: row.reputation_score,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function mapStatsRow(row: WarmupDailyStatsRow): WarmupDailyStats {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    date: row.date,
    dayNumber: row.day_number,
    targetSends: row.target_sends,
    actualSends: row.actual_sends,
    successfulSends: row.successful_sends,
    failedSends: row.failed_sends,
    bouncedSends: row.bounced_sends,
    repliesReceived: row.replies_received,
    opensTracked: row.opens_tracked,
    clicksTracked: row.clicks_tracked,
    spamReports: row.spam_reports,
    healthScore: row.health_score,
    reputationScore: row.reputation_score,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function mapEventRow(row: WarmupEventRow): WarmupEvent {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    previousStage: row.previous_stage,
    newStage: row.new_stage,
    previousHealth: row.previous_health,
    newHealth: row.new_health,
    message: row.message,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function mapHistoryRow(row: WarmupHistoryRow): WarmupHistoryEntry {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    action: row.action,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    previousConfig: row.previous_config,
    newConfig: row.new_config,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function mapTemplateRow(row: WarmupTemplateRow): WarmupTemplate {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    isDefault: row.is_default,
    maxDailySends: row.max_daily_sends,
    dailyIncrease: row.daily_increase,
    initialSends: row.initial_sends,
    totalDays: row.total_days,
    weekendSending: row.weekend_sending,
    businessHoursStart: row.business_hours_start,
    businessHoursEnd: row.business_hours_end,
    timezone: row.timezone,
    minDelayMs: row.min_delay_ms,
    maxDelayMs: row.max_delay_ms,
    randomizationFactor: row.randomization_factor,
    replySimulation: row.reply_simulation,
    readSimulation: row.read_simulation,
    spamRescue: row.spam_rescue,
    openSimulation: row.open_simulation,
    clickSimulation: row.click_simulation,
    targetHealthScore: row.target_health_score,
    graduationThreshold: row.graduation_threshold,
    pauseThreshold: row.pause_threshold,
    resumeThreshold: row.resume_threshold,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapExceptionRow(row: WarmupExceptionRow): WarmupException {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    exceptionType: row.exception_type,
    dayNumber: row.day_number,
    reason: row.reason,
    volumeModifier: row.volume_modifier,
    isApplied: row.is_applied,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

function mapGraduationRow(row: WarmupGraduationRow): WarmupGraduation {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    mailboxId: row.mailbox_id,
    finalHealthScore: row.final_health_score,
    finalReputationScore: row.final_reputation_score,
    totalDays: row.total_days,
    totalSends: row.total_sends,
    totalSuccessful: row.total_successful,
    totalBounced: row.total_bounced,
    graduationReason: row.graduation_reason,
    metadata: row.metadata || {},
    graduatedAt: row.graduated_at,
    createdAt: row.created_at,
  }
}

function mapNotificationRow(row: WarmupNotificationRow): WarmupNotification {
  return {
    id: row.id,
    configId: row.config_id,
    organizationId: row.organization_id,
    notificationType: row.notification_type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    isRead: row.is_read,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

// ============================================================
// Config CRUD
// ============================================================

export async function findConfigById(id: string, orgId: string): Promise<WarmupConfigModel | null> {
  const result = await pool.query<WarmupConfigRow>(
    `SELECT * FROM public.mail_warmup_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapConfigRow(result.rows[0]) : null
}

export async function findConfigsByOrg(orgId: string): Promise<WarmupConfigModel[]> {
  const result = await pool.query<WarmupConfigRow>(
    `SELECT * FROM public.mail_warmup_configs WHERE organization_id = $1 ORDER BY created_at DESC`,
    [orgId]
  )
  return result.rows.map(mapConfigRow)
}

export async function findConfigsByStatus(orgId: string, status: WarmupConfigStatus): Promise<WarmupConfigModel[]> {
  const result = await pool.query<WarmupConfigRow>(
    `SELECT * FROM public.mail_warmup_configs WHERE organization_id = $1 AND status = $2 ORDER BY created_at DESC`,
    [orgId, status]
  )
  return result.rows.map(mapConfigRow)
}

export async function findConfigByMailboxId(mailboxId: string, orgId: string): Promise<WarmupConfigModel | null> {
  const result = await pool.query<WarmupConfigRow>(
    `SELECT * FROM public.mail_warmup_configs WHERE mailbox_id = $1 AND organization_id = $2`,
    [mailboxId, orgId]
  )
  return result.rows[0] ? mapConfigRow(result.rows[0]) : null
}

export async function findActiveConfigByMailboxId(mailboxId: string, orgId: string): Promise<WarmupConfigModel | null> {
  const result = await pool.query<WarmupConfigRow>(
    `SELECT * FROM public.mail_warmup_configs
     WHERE mailbox_id = $1 AND organization_id = $2 AND status IN ('pending', 'running')
     ORDER BY created_at DESC LIMIT 1`,
    [mailboxId, orgId]
  )
  return result.rows[0] ? mapConfigRow(result.rows[0]) : null
}

export async function findConfigsByStatusPaginated(
  orgId: string,
  status: WarmupConfigStatus | 'all',
  search: string,
  sortBy: string,
  sortDirection: 'asc' | 'desc',
  offset: number,
  limit: number
): Promise<{ configs: WarmupConfigModel[]; total: number }> {
  const conditions: string[] = ['c.organization_id = $1']
  const values: unknown[] = [orgId]
  let paramIndex = 2

  if (status && status !== 'all') {
    conditions.push(`c.status = $${paramIndex}`)
    values.push(status)
    paramIndex++
  }

  if (search && search.trim()) {
    conditions.push(`(m.email ILIKE $${paramIndex} OR m.display_name ILIKE $${paramIndex})`)
    values.push(`%${search.trim()}%`)
    paramIndex++
  }

  const where = conditions.join(' AND ')
  const sortCol = sortBy === 'email' ? 'm.email' : sortBy === 'status' ? 'c.status' : sortBy === 'health' ? 'c.health' : 'c.created_at'
  const sortDir = sortDirection === 'asc' ? 'ASC' : 'DESC'

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM public.mail_warmup_configs c
     JOIN public.mail_mailboxes m ON m.id = c.mailbox_id
     WHERE ${where}`,
    values
  )
  const total = countResult.rows[0]?.count ?? 0

  values.push(limit, offset)
  const result = await pool.query<WarmupConfigRow>(
    `SELECT c.*
     FROM public.mail_warmup_configs c
     JOIN public.mail_mailboxes m ON m.id = c.mailbox_id
     WHERE ${where}
     ORDER BY ${sortCol} ${sortDir} NULLS LAST
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )

  return { configs: result.rows.map(mapConfigRow), total }
}

export async function insertConfig(
  orgId: string,
  data: {
    mailboxId: string
    status: WarmupConfigStatus
    stage: WarmupStage
    health: WarmupHealth
    startDate: string | null
    initialSends: number
    maxDailySends: number
    dailyIncrease: number
    currentDailyTarget: number
    totalDays: number
    weekendSending: boolean
    businessHoursStart: number
    businessHoursEnd: number
    timezone: string
    minDelayMs: number
    maxDelayMs: number
    randomizationFactor: number
    replySimulation: boolean
    readSimulation: boolean
    spamRescue: boolean
    openSimulation: boolean
    clickSimulation: boolean
    targetHealthScore: number
    graduationThreshold: number
    pauseThreshold: number
    resumeThreshold: number
    metadata: Record<string, unknown>
  }
): Promise<WarmupConfigModel> {
  const result = await pool.query<WarmupConfigRow>(
    `INSERT INTO public.mail_warmup_configs
      (organization_id, mailbox_id, status, stage, health, start_date,
       initial_sends, max_daily_sends, daily_increase, current_daily_target, total_days,
       weekend_sending, business_hours_start, business_hours_end, timezone,
       min_delay_ms, max_delay_ms, randomization_factor,
       reply_simulation, read_simulation, spam_rescue, open_simulation, click_simulation,
       target_health_score, graduation_threshold, pause_threshold, resume_threshold, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
     RETURNING *`,
    [
      orgId, data.mailboxId, data.status, data.stage, data.health, data.startDate,
      data.initialSends, data.maxDailySends, data.dailyIncrease, data.currentDailyTarget, data.totalDays,
      data.weekendSending, data.businessHoursStart, data.businessHoursEnd, data.timezone,
      data.minDelayMs, data.maxDelayMs, data.randomizationFactor,
      data.replySimulation, data.readSimulation, data.spamRescue, data.openSimulation, data.clickSimulation,
      data.targetHealthScore, data.graduationThreshold, data.pauseThreshold, data.resumeThreshold,
      JSON.stringify(data.metadata),
    ]
  )
  return mapConfigRow(result.rows[0])
}

export async function updateConfig(
  id: string,
  orgId: string,
  data: Partial<{
    status: WarmupConfigStatus
    stage: WarmupStage
    health: WarmupHealth
    startDate: string | null
    endDate: string | null
    pausedAt: string | null
    resumedAt: string | null
    graduatedAt: string | null
    currentDay: number
    currentDailyTarget: number
    initialSends: number
    maxDailySends: number
    dailyIncrease: number
    totalDays: number
    weekendSending: boolean
    businessHoursStart: number
    businessHoursEnd: number
    timezone: string
    minDelayMs: number
    maxDelayMs: number
    randomizationFactor: number
    replySimulation: boolean
    readSimulation: boolean
    spamRescue: boolean
    openSimulation: boolean
    clickSimulation: boolean
    targetHealthScore: number
    graduationThreshold: number
    pauseThreshold: number
    resumeThreshold: number
    pauseReason: string | null
    failureReason: string | null
    metadata: Record<string, unknown>
  }>
): Promise<WarmupConfigModel | null> {
  const fieldMap: Record<string, string> = {
    status: 'status', stage: 'stage', health: 'health',
    startDate: 'start_date', endDate: 'end_date',
    pausedAt: 'paused_at', resumedAt: 'resumed_at', graduatedAt: 'graduated_at',
    currentDay: 'current_day', currentDailyTarget: 'current_daily_target',
    initialSends: 'initial_sends', maxDailySends: 'max_daily_sends',
    dailyIncrease: 'daily_increase', totalDays: 'total_days',
    weekendSending: 'weekend_sending',
    businessHoursStart: 'business_hours_start', businessHoursEnd: 'business_hours_end',
    timezone: 'timezone', minDelayMs: 'min_delay_ms', maxDelayMs: 'max_delay_ms',
    randomizationFactor: 'randomization_factor',
    replySimulation: 'reply_simulation', readSimulation: 'read_simulation',
    spamRescue: 'spam_rescue', openSimulation: 'open_simulation', clickSimulation: 'click_simulation',
    targetHealthScore: 'target_health_score', graduationThreshold: 'graduation_threshold',
    pauseThreshold: 'pause_threshold', resumeThreshold: 'resume_threshold',
    pauseReason: 'pause_reason', failureReason: 'failure_reason',
    metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = (data as Record<string, unknown>)[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(key === 'metadata' ? JSON.stringify(val) : val)
    }
  }

  if (setClauses.length === 0) {
    return findConfigById(id, orgId)
  }

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<WarmupConfigRow>(
    `UPDATE public.mail_warmup_configs SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapConfigRow(result.rows[0]) : null
}

export async function deleteConfig(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_warmup_configs WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function countConfigsByOrg(orgId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_warmup_configs WHERE organization_id = $1`,
    [orgId]
  )
  return result.rows[0]?.count ?? 0
}

export async function countConfigsByStatus(orgId: string): Promise<Record<string, number>> {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM public.mail_warmup_configs WHERE organization_id = $1
     GROUP BY status`,
    [orgId]
  )
  const counts: Record<string, number> = {}
  for (const row of result.rows) {
    counts[row.status] = row.count
  }
  return counts
}

export async function getDashboardStats(orgId: string): Promise<{
  totalConfigs: number
  running: number
  paused: number
  graduated: number
  totalMailboxesWarming: number
  avgHealthScore: number
  graduationRate: number
}> {
  const counts = await countConfigsByStatus(orgId)
  const totalConfigs = Object.values(counts).reduce((a, b) => a + b, 0)
  const running = counts['running'] ?? 0
  const paused = counts['paused'] ?? 0
  const graduated = counts['graduated'] ?? 0

  const avgResult = await pool.query(
    `SELECT COALESCE(AVG(health_score), 0)::numeric AS avg_health
     FROM public.mail_warmup_configs
     WHERE organization_id = $1 AND status IN ('running', 'paused')`,
    [orgId]
  )
  const avgHealthScore = Math.round(Number(avgResult.rows[0]?.avg_health) || 0)

  const graduationRate = totalConfigs > 0 ? Math.round((graduated / totalConfigs) * 100) : 0

  return {
    totalConfigs,
    running,
    paused,
    graduated,
    totalMailboxesWarming: running + paused,
    avgHealthScore,
    graduationRate,
  }
}

// ============================================================
// Stage CRUD
// ============================================================

export async function findStagesByConfigId(configId: string): Promise<WarmupStageModel[]> {
  const result = await pool.query<WarmupStageRow>(
    `SELECT * FROM public.mail_warmup_stages WHERE config_id = $1 ORDER BY day_number ASC`,
    [configId]
  )
  return result.rows.map(mapStageRow)
}

export async function findStageByConfigAndDay(configId: string, dayNumber: number): Promise<WarmupStageModel | null> {
  const result = await pool.query<WarmupStageRow>(
    `SELECT * FROM public.mail_warmup_stages WHERE config_id = $1 AND day_number = $2`,
    [configId, dayNumber]
  )
  return result.rows[0] ? mapStageRow(result.rows[0]) : null
}

export async function insertStage(data: {
  configId: string
  organizationId: string
  stage: WarmupStage
  dayNumber: number
  targetSends: number
}): Promise<WarmupStageModel> {
  const result = await pool.query<WarmupStageRow>(
    `INSERT INTO public.mail_warmup_stages (config_id, organization_id, stage, day_number, target_sends, started_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [data.configId, data.organizationId, data.stage, data.dayNumber, data.targetSends]
  )
  return mapStageRow(result.rows[0])
}

export async function updateStage(
  configId: string,
  dayNumber: number,
  data: Partial<{
    actualSends: number
    successCount: number
    failureCount: number
    bounceCount: number
    healthScore: number | null
    reputationScore: number | null
    completedAt: string | null
  }>
): Promise<WarmupStageModel | null> {
  const fieldMap: Record<string, string> = {
    actualSends: 'actual_sends', successCount: 'success_count',
    failureCount: 'failure_count', bounceCount: 'bounce_count',
    healthScore: 'health_score', reputationScore: 'reputation_score',
    completedAt: 'completed_at',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = (data as Record<string, unknown>)[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(val)
    }
  }

  if (setClauses.length === 0) {
    return findStageByConfigAndDay(configId, dayNumber)
  }

  values.push(configId, dayNumber)

  const result = await pool.query<WarmupStageRow>(
    `UPDATE public.mail_warmup_stages SET ${setClauses.join(', ')}
     WHERE config_id = $${paramIndex} AND day_number = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapStageRow(result.rows[0]) : null
}

// ============================================================
// Daily Stats CRUD
// ============================================================

export async function findStatsByConfigId(configId: string): Promise<WarmupDailyStats[]> {
  const result = await pool.query<WarmupDailyStatsRow>(
    `SELECT * FROM public.mail_warmup_daily_stats WHERE config_id = $1 ORDER BY date DESC`,
    [configId]
  )
  return result.rows.map(mapStatsRow)
}

export async function findStatsByConfigAndDate(configId: string, date: string): Promise<WarmupDailyStats | null> {
  const result = await pool.query<WarmupDailyStatsRow>(
    `SELECT * FROM public.mail_warmup_daily_stats WHERE config_id = $1 AND date = $2`,
    [configId, date]
  )
  return result.rows[0] ? mapStatsRow(result.rows[0]) : null
}

export async function findTodayStats(configId: string): Promise<WarmupDailyStats | null> {
  const result = await pool.query<WarmupDailyStatsRow>(
    `SELECT * FROM public.mail_warmup_daily_stats WHERE config_id = $1 AND date = CURRENT_DATE`,
    [configId]
  )
  return result.rows[0] ? mapStatsRow(result.rows[0]) : null
}

export async function upsertDailyStats(data: {
  configId: string
  organizationId: string
  date: string
  dayNumber: number
  targetSends: number
  actualSends?: number
  successfulSends?: number
  failedSends?: number
  bouncedSends?: number
  repliesReceived?: number
  opensTracked?: number
  clicksTracked?: number
  spamReports?: number
  healthScore?: number | null
  reputationScore?: number | null
}): Promise<WarmupDailyStats> {
  const result = await pool.query<WarmupDailyStatsRow>(
    `INSERT INTO public.mail_warmup_daily_stats
      (config_id, organization_id, date, day_number, target_sends,
       actual_sends, successful_sends, failed_sends, bounced_sends,
       replies_received, opens_tracked, clicks_tracked, spam_reports,
       health_score, reputation_score)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (config_id, date) DO UPDATE SET
       actual_sends = EXCLUDED.actual_sends,
       successful_sends = EXCLUDED.successful_sends,
       failed_sends = EXCLUDED.failed_sends,
       bounced_sends = EXCLUDED.bounced_sends,
       replies_received = EXCLUDED.replies_received,
       opens_tracked = EXCLUDED.opens_tracked,
       clicks_tracked = EXCLUDED.clicks_tracked,
       spam_reports = EXCLUDED.spam_reports,
       health_score = EXCLUDED.health_score,
       reputation_score = EXCLUDED.reputation_score
     RETURNING *`,
    [
      data.configId, data.organizationId, data.date, data.dayNumber, data.targetSends,
      data.actualSends ?? 0, data.successfulSends ?? 0, data.failedSends ?? 0, data.bouncedSends ?? 0,
      data.repliesReceived ?? 0, data.opensTracked ?? 0, data.clicksTracked ?? 0, data.spamReports ?? 0,
      data.healthScore ?? null, data.reputationScore ?? null,
    ]
  )
  return mapStatsRow(result.rows[0])
}

// ============================================================
// Events
// ============================================================

export async function insertEvent(data: {
  configId: string
  organizationId: string
  eventType: WarmupEventType
  previousStatus?: string | null
  newStatus?: string | null
  previousStage?: string | null
  newStage?: string | null
  previousHealth?: string | null
  newHealth?: string | null
  message: string
  metadata?: Record<string, unknown>
}): Promise<WarmupEvent> {
  const result = await pool.query<WarmupEventRow>(
    `INSERT INTO public.mail_warmup_events
      (config_id, organization_id, event_type, previous_status, new_status,
       previous_stage, new_stage, previous_health, new_health, message, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      data.configId, data.organizationId, data.eventType,
      data.previousStatus ?? null, data.newStatus ?? null,
      data.previousStage ?? null, data.newStage ?? null,
      data.previousHealth ?? null, data.newHealth ?? null,
      data.message,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapEventRow(result.rows[0])
}

export async function findEventsByConfigId(configId: string, limit: number = 50): Promise<WarmupEvent[]> {
  const result = await pool.query<WarmupEventRow>(
    `SELECT * FROM public.mail_warmup_events WHERE config_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [configId, limit]
  )
  return result.rows.map(mapEventRow)
}

// ============================================================
// History
// ============================================================

export async function insertHistory(data: {
  configId: string
  organizationId: string
  action: string
  actorUserId: string
  actorEmail: string
  previousConfig?: Record<string, unknown> | null
  newConfig?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
}): Promise<WarmupHistoryEntry> {
  const result = await pool.query<WarmupHistoryRow>(
    `INSERT INTO public.mail_warmup_history
      (config_id, organization_id, action, actor_user_id, actor_email, previous_config, new_config, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      data.configId, data.organizationId, data.action,
      data.actorUserId, data.actorEmail,
      data.previousConfig ? JSON.stringify(data.previousConfig) : null,
      data.newConfig ? JSON.stringify(data.newConfig) : null,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapHistoryRow(result.rows[0])
}

export async function findHistoryByConfigId(configId: string, limit: number = 50): Promise<WarmupHistoryEntry[]> {
  const result = await pool.query<WarmupHistoryRow>(
    `SELECT * FROM public.mail_warmup_history WHERE config_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [configId, limit]
  )
  return result.rows.map(mapHistoryRow)
}

// ============================================================
// Templates
// ============================================================

export async function findTemplatesByOrg(orgId: string): Promise<WarmupTemplate[]> {
  const result = await pool.query<WarmupTemplateRow>(
    `SELECT * FROM public.mail_warmup_templates WHERE organization_id = $1 ORDER BY name ASC`,
    [orgId]
  )
  return result.rows.map(mapTemplateRow)
}

export async function findTemplateById(id: string, orgId: string): Promise<WarmupTemplate | null> {
  const result = await pool.query<WarmupTemplateRow>(
    `SELECT * FROM public.mail_warmup_templates WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapTemplateRow(result.rows[0]) : null
}

export async function findDefaultTemplate(orgId: string): Promise<WarmupTemplate | null> {
  const result = await pool.query<WarmupTemplateRow>(
    `SELECT * FROM public.mail_warmup_templates WHERE organization_id = $1 AND is_default = TRUE LIMIT 1`,
    [orgId]
  )
  return result.rows[0] ? mapTemplateRow(result.rows[0]) : null
}

export async function insertTemplate(
  orgId: string,
  data: {
    name: string
    description: string
    isDefault: boolean
    maxDailySends: number
    dailyIncrease: number
    initialSends: number
    totalDays: number
    weekendSending: boolean
    businessHoursStart: number
    businessHoursEnd: number
    timezone: string
    minDelayMs: number
    maxDelayMs: number
    randomizationFactor: number
    replySimulation: boolean
    readSimulation: boolean
    spamRescue: boolean
    openSimulation: boolean
    clickSimulation: boolean
    targetHealthScore: number
    graduationThreshold: number
    pauseThreshold: number
    resumeThreshold: number
    metadata: Record<string, unknown>
  }
): Promise<WarmupTemplate> {
  const result = await pool.query<WarmupTemplateRow>(
    `INSERT INTO public.mail_warmup_templates
      (organization_id, name, description, is_default,
       max_daily_sends, daily_increase, initial_sends, total_days,
       weekend_sending, business_hours_start, business_hours_end, timezone,
       min_delay_ms, max_delay_ms, randomization_factor,
       reply_simulation, read_simulation, spam_rescue, open_simulation, click_simulation,
       target_health_score, graduation_threshold, pause_threshold, resume_threshold, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     RETURNING *`,
    [
      orgId, data.name, data.description, data.isDefault,
      data.maxDailySends, data.dailyIncrease, data.initialSends, data.totalDays,
      data.weekendSending, data.businessHoursStart, data.businessHoursEnd, data.timezone,
      data.minDelayMs, data.maxDelayMs, data.randomizationFactor,
      data.replySimulation, data.readSimulation, data.spamRescue, data.openSimulation, data.clickSimulation,
      data.targetHealthScore, data.graduationThreshold, data.pauseThreshold, data.resumeThreshold,
      JSON.stringify(data.metadata),
    ]
  )
  return mapTemplateRow(result.rows[0])
}

export async function deleteTemplate(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_warmup_templates WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

// ============================================================
// Exceptions
// ============================================================

export async function findExceptionsByConfigId(configId: string): Promise<WarmupException[]> {
  const result = await pool.query<WarmupExceptionRow>(
    `SELECT * FROM public.mail_warmup_exceptions WHERE config_id = $1 ORDER BY day_number ASC`,
    [configId]
  )
  return result.rows.map(mapExceptionRow)
}

export async function insertException(data: {
  configId: string
  organizationId: string
  exceptionType: WarmupExceptionType
  dayNumber: number
  reason: string
  volumeModifier?: number | null
  metadata?: Record<string, unknown>
}): Promise<WarmupException> {
  const result = await pool.query<WarmupExceptionRow>(
    `INSERT INTO public.mail_warmup_exceptions
      (config_id, organization_id, exception_type, day_number, reason, volume_modifier, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      data.configId, data.organizationId, data.exceptionType,
      data.dayNumber, data.reason, data.volumeModifier ?? null,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapExceptionRow(result.rows[0])
}

export async function markExceptionApplied(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.mail_warmup_exceptions SET is_applied = TRUE WHERE id = $1`,
    [id]
  )
  return (result.rowCount ?? 0) > 0
}

// ============================================================
// Graduations
// ============================================================

export async function insertGraduation(data: {
  configId: string
  organizationId: string
  mailboxId: string
  finalHealthScore: number
  finalReputationScore: number | null
  totalDays: number
  totalSends: number
  totalSuccessful: number
  totalBounced: number
  graduationReason: string
  metadata?: Record<string, unknown>
}): Promise<WarmupGraduation> {
  const result = await pool.query<WarmupGraduationRow>(
    `INSERT INTO public.mail_warmup_graduations
      (config_id, organization_id, mailbox_id, final_health_score, final_reputation_score,
       total_days, total_sends, total_successful, total_bounced, graduation_reason, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      data.configId, data.organizationId, data.mailboxId,
      data.finalHealthScore, data.finalReputationScore,
      data.totalDays, data.totalSends, data.totalSuccessful, data.totalBounced,
      data.graduationReason, JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapGraduationRow(result.rows[0])
}

export async function findGraduationsByOrg(orgId: string, limit: number = 50): Promise<WarmupGraduation[]> {
  const result = await pool.query<WarmupGraduationRow>(
    `SELECT * FROM public.mail_warmup_graduations WHERE organization_id = $1 ORDER BY graduated_at DESC LIMIT $2`,
    [orgId, limit]
  )
  return result.rows.map(mapGraduationRow)
}

// ============================================================
// Notifications
// ============================================================

export async function insertNotification(data: {
  configId: string
  organizationId: string
  notificationType: WarmupNotificationType
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<WarmupNotification> {
  const result = await pool.query<WarmupNotificationRow>(
    `INSERT INTO public.mail_warmup_notifications
      (config_id, organization_id, notification_type, severity, title, message, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      data.configId, data.organizationId, data.notificationType,
      data.severity, data.title, data.message,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapNotificationRow(result.rows[0])
}

export async function findUnreadNotifications(configId: string): Promise<WarmupNotification[]> {
  const result = await pool.query<WarmupNotificationRow>(
    `SELECT * FROM public.mail_warmup_notifications WHERE config_id = $1 AND is_read = FALSE ORDER BY created_at DESC`,
    [configId]
  )
  return result.rows.map(mapNotificationRow)
}

export async function countUnreadNotifications(configId: string): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mail_warmup_notifications WHERE config_id = $1 AND is_read = FALSE`,
    [configId]
  )
  return result.rows[0]?.count ?? 0
}

export async function markNotificationRead(id: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.mail_warmup_notifications SET is_read = TRUE WHERE id = $1`,
    [id]
  )
  return (result.rowCount ?? 0) > 0
}

export async function markAllNotificationsRead(configId: string): Promise<number> {
  const result = await pool.query(
    `UPDATE public.mail_warmup_notifications SET is_read = TRUE WHERE config_id = $1 AND is_read = FALSE`,
    [configId]
  )
  return result.rowCount ?? 0
}
