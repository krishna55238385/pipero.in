// ============================================================
// Mail Module — Enums
// ============================================================

export type MailboxStatus =
  | 'connected'
  | 'disconnected'
  | 'warming'
  | 'error'
  | 'suspended'
  | 'pending'
  | 'testing'
  | 'disabled'
  | 'archived'
  | 'deleted'
  | 'reconnect_required'
  | 'oauth_expired'
  | 'smtp_failed'
  | 'imap_failed'
  | 'verification_failed'
  | 'pending_dns'
  | 'pending_warmup'
  | 'at_risk'

export type MailboxHealth = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

export type MailboxProvider = 'gmail' | 'outlook' | 'zoho' | 'custom'

export type OAuthProvider = 'gmail' | 'outlook' | 'zoho'

export type AuthType = 'oauth' | 'smtp' | 'imap'

export type SMTPEncryption = 'none' | 'ssl' | 'starttls'

export type SMTPAuthenticationType = 'password' | 'oauth2' | 'ntlm'

export type ValidationStatus = 'unvalidated' | 'valid' | 'invalid'

export type MailboxVerificationStatus = 'unverified' | 'pending' | 'verified' | 'failed'

export type WarmupStatus = 'idle' | 'warming' | 'paused' | 'completed' | 'error'

// ============================================================
// Warmup Engine — Enums
// ============================================================

export type WarmupConfigStatus = 'draft' | 'pending' | 'running' | 'paused' | 'completed' | 'graduated' | 'disabled' | 'failed' | 'cancelled'

export type WarmupStage = 'initial' | 'learning' | 'growing' | 'established' | 'graduated'

export type WarmupHealth = 'excellent' | 'healthy' | 'warning' | 'critical'

export type WarmupEventType =
  | 'created' | 'started' | 'paused' | 'resumed' | 'graduated'
  | 'archived' | 'deleted' | 'updated' | 'stage_changed'
  | 'health_changed' | 'configured' | 'error' | 'reset'

export type WarmupExceptionType = 'skip_day' | 'reduce_volume' | 'increase_volume' | 'pause' | 'custom'

export type WarmupNotificationType =
  | 'health_warning' | 'health_critical' | 'graduation_ready'
  | 'graduated' | 'paused' | 'resumed' | 'error' | 'milestone'

export type WarmupGraduationReason = 'threshold_met' | 'manual' | 'max_days_reached'

export type PoolStatus = 'active' | 'inactive'

export type SendingStrategy = 'standard' | 'throttled' | 'aggressive' | 'conservative'

export type RotationStrategy = 'round_robin' | 'weighted' | 'least_used' | 'random' | 'priority' | 'adaptive'

export type PoolMembershipRole = 'primary' | 'backup' | 'disabled'

export type PoolHealthWarning = {
  type: 'low_health' | 'high_usage' | 'mailbox_error' | 'dns_issue' | 'warmup_pending'
  mailboxId?: string
  mailboxEmail?: string
  message: string
  severity: 'info' | 'warning' | 'critical'
}

export type MailboxConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error'

export type MailPermissionType =
  | 'mail.read'
  | 'mail.write'
  | 'mail.manage'
  | 'mail.admin'

export type MailPermissions = {
  canRead: boolean
  canWrite: boolean
  canManage: boolean
  canAdmin: boolean
}

// ============================================================
// Mail Module — Database Models
// ============================================================

export type MailboxPool = {
  id: string
  organizationId: string
  name: string
  description: string
  status: PoolStatus
  dailyPoolLimit: number
  sendingStrategy: SendingStrategy
  rotationStrategy: RotationStrategy
  maxConcurrentSends: number
  timezone: string
  memberMailboxes: Mailbox[]
  healthAggregation: PoolHealthAggregation | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type PoolHealthAggregation = {
  avgHealthScore: number | null
  totalMailboxes: number
  connectedCount: number
  warmingCount: number
  errorCount: number
  totalDailyCapacity: number
  usedToday: number
  warnings: PoolHealthWarning[]
}

export type Mailbox = {
  id: string
  organizationId: string
  poolId: string | null
  provider: MailboxProvider
  authType: AuthType
  email: string
  displayName: string
  senderName: string
  providerAccountId: string | null
  timezone: string
  dailyLimit: number
  hourlySendLimit?: number
  currentDailyUsage: number
  healthScore: number | null
  healthStatus: MailboxHealth
  mailboxStatus: MailboxStatus
  verificationStatus: MailboxVerificationStatus
  warmupStatus: WarmupStatus
  lastVerifiedAt: string | null
  lastVerificationDurationMs: number | null
  lastVerificationResult: string | null
  deletedAt: string | null
  archivedAt: string | null
  oauthConfig: OAuthConfig | null
  smtpConfig: SMTPConfig | null
  imapConfig: IMAPConfig | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type OAuthConfig = {
  id: string
  mailboxId: string
  organizationId: string
  provider: OAuthProvider
  providerAccountId: string
  encryptedRefreshToken: string | null
  encryptedAccessToken: string | null
  tokenExpiresAt: string | null
  scope: string
  lastRotatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SMTPConfig = {
  id: string
  mailboxId: string
  organizationId: string
  smtpHost: string
  smtpPort: number
  encryption: SMTPEncryption
  username: string
  encryptedPasswordReference: string
  authenticationType: SMTPAuthenticationType
  validationStatus: ValidationStatus
  lastValidatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type IMAPConfig = {
  id: string
  mailboxId: string
  organizationId: string
  host: string
  port: number
  ssl: boolean
  username: string
  encryptedPasswordReference: string | null
  authentication: 'password' | 'oauth2'
  validationStatus: ValidationStatus
  lastValidatedAt: string | null
  createdAt: string
  updatedAt: string
}

// ============================================================
// Mail Module — Non-mailbox models (kept for future use)
// ============================================================

export type MailCampaignStatus = 'draft' | 'scheduled' | 'running' | 'completed' | 'paused' | 'cancelled'

export type Campaign = {
  id: string
  name: string
  mailboxId: string
  status: MailCampaignStatus
  subject: string
  bodyHtml: string
  recipientCount: number
  sentCount: number
  openCount: number
  clickCount: number
  replyCount: number
  bounceCount: number
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  organizationId: string
}

export type LeadStatus = 'new' | 'contacted' | 'replied' | 'interested' | 'meeting_booked' | 'won' | 'lost'

export type Lead = {
  id: string
  email: string
  name: string
  company: string
  jobTitle: string
  status: LeadStatus
  source: string
  verifiedStatus: 'unverified' | 'valid' | 'invalid' | 'risky' | 'catch_all' | 'no_mx'
  suppressed: boolean
  lastContactedAt: string | null
  createdAt: string
  updatedAt: string
  organizationId: string
}

export type WarmupConfig = {
  id: string
  mailboxId: string
  status: WarmupStatus
  dailyLimit: number
  currentDay: number
  totalDays: number
  healthScore: number | null
  spamScore: number | null
  startedAt: string | null
  createdAt: string
}

// ============================================================
// Warmup Engine — Database Models
// ============================================================

export type WarmupConfigModel = {
  id: string
  organizationId: string
  mailboxId: string
  status: WarmupConfigStatus
  stage: WarmupStage
  health: WarmupHealth
  startDate: string | null
  endDate: string | null
  pausedAt: string | null
  resumedAt: string | null
  graduatedAt: string | null
  currentDay: number
  totalDays: number
  initialSends: number
  maxDailySends: number
  dailyIncrease: number
  currentDailyTarget: number
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
  createdAt: string
  updatedAt: string
}

export type WarmupStageModel = {
  id: string
  configId: string
  organizationId: string
  stage: WarmupStage
  dayNumber: number
  targetSends: number
  actualSends: number
  successCount: number
  failureCount: number
  bounceCount: number
  healthScore: number | null
  reputationScore: number | null
  startedAt: string | null
  completedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type WarmupDailyStats = {
  id: string
  configId: string
  organizationId: string
  date: string
  dayNumber: number
  targetSends: number
  actualSends: number
  successfulSends: number
  failedSends: number
  bouncedSends: number
  repliesReceived: number
  opensTracked: number
  clicksTracked: number
  spamReports: number
  healthScore: number | null
  reputationScore: number | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type WarmupEvent = {
  id: string
  configId: string
  organizationId: string
  eventType: WarmupEventType
  previousStatus: string | null
  newStatus: string | null
  previousStage: string | null
  newStage: string | null
  previousHealth: string | null
  newHealth: string | null
  message: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type WarmupHistoryEntry = {
  id: string
  configId: string
  organizationId: string
  action: string
  actorUserId: string
  actorEmail: string
  previousConfig: Record<string, unknown> | null
  newConfig: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type WarmupTemplate = {
  id: string
  organizationId: string
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
  createdAt: string
  updatedAt: string
}

export type WarmupException = {
  id: string
  configId: string
  organizationId: string
  exceptionType: WarmupExceptionType
  dayNumber: number
  reason: string
  volumeModifier: number | null
  isApplied: boolean
  metadata: Record<string, unknown>
  createdAt: string
}

export type WarmupGraduation = {
  id: string
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
  metadata: Record<string, unknown>
  graduatedAt: string
  createdAt: string
}

export type WarmupNotification = {
  id: string
  configId: string
  organizationId: string
  notificationType: WarmupNotificationType
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  isRead: boolean
  metadata: Record<string, unknown>
  createdAt: string
}

export type SequenceStep = {
  id: string
  stepNumber: number
  subject: string
  bodyHtml: string
  delayDays: number
}

export type Sequence = {
  id: string
  name: string
  description: string | null
  steps: SequenceStep[]
  leadCount: number
  createdAt: string
  updatedAt: string
  organizationId: string
}

export type AnalyticsPeriod = '7d' | '30d' | '90d' | 'custom'

export type AnalyticsOverview = {
  totalSent: number
  totalDelivered: number
  totalOpened: number
  totalClicked: number
  totalReplied: number
  totalBounced: number
  totalUnsubscribed: number
  openRate: number
  clickRate: number
  replyRate: number
  bounceRate: number
  deliveryRate: number
  timeSeries: AnalyticsTimeSeriesPoint[]
}

export type AnalyticsTimeSeriesPoint = {
  date: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  replied: number
  bounced: number
}

export type CampaignAnalyticsRow = {
  campaignId: string
  name: string
  status: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  unsubscribed: number
  openRate: number
  clickRate: number
  replyRate: number
  bounceRate: number
}

export type MailboxAnalyticsRow = {
  mailboxId: string
  email: string
  sends: number
  opens: number
  clicks: number
  replies: number
  bounces: number
  bounceRate: number
  openRate: number
}

export type MailboxHealthAnalyticsRow = {
  mailboxId: string
  email: string
  status: string
  healthScore: number
  sends7d: number
  bounces7d: number
  bounceRate7d: number
  complaints7d: number
  complaintRate7d: number
  reputationScore: number | null
  reputationLevel: string | null
}

export type PlacementAnalyticsPoint = {
  date: string
  inbox: number
  spam: number
  unknown: number
  inboxRate: number
  spamRate: number
}

export type ScheduledReportCadence = 'daily' | 'weekly' | 'monthly'
export type ScheduledReportType =
  | 'campaigns'
  | 'mailboxes'
  | 'leads'
  | 'analytics_raw'
  | 'placement'
  | 'usage'

export type ScheduledReport = {
  id: string
  organizationId: string
  name: string
  reportType: ScheduledReportType
  cadence: ScheduledReportCadence
  recipients: string[]
  format: 'csv'
  isActive: boolean
  nextRunAt: string
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  createdBy: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type MailAnalyticsDashboard = {
  overview: AnalyticsOverview
  campaigns: CampaignAnalyticsRow[]
  mailboxes: MailboxAnalyticsRow[]
  mailboxHealth: MailboxHealthAnalyticsRow[]
  placement: PlacementAnalyticsPoint[]
  periodDays: number
  riskScore: number
  recommendations: string[]
}

export type MailSettings = {
  organizationId: string
  defaultSignature: string | null
  physicalAddress: string | null
  companyName: string | null
  trackingEnabled: boolean
  openTracking: boolean
  clickTracking: boolean
  unsubscribeLink: boolean
  dailySendLimit: number
  warmupEnabled: boolean
  businessHoursStart: number
  businessHoursEnd: number
  defaultTimezone: string
  rotationStrategy: string
  hourlySendLimit: number
  createdAt: string
  updatedAt: string
}

// ============================================================
// Mail Module — DTOs (Request / Response)
// ============================================================

export type CreateMailboxRequest = {
  email: string
  displayName?: string
  senderName?: string
  provider: MailboxProvider
  authType: AuthType
  timezone?: string
  dailyLimit?: number
  poolId?: string | null
  providerAccountId?: string
  metadata?: Record<string, unknown>
}

export type UpdateMailboxRequest = {
  displayName?: string
  senderName?: string
  timezone?: string
  dailyLimit?: number
  poolId?: string | null
  metadata?: Record<string, unknown>
}

export type MailboxResponse = {
  id: string
  organizationId: string
  poolId: string | null
  provider: MailboxProvider
  authType: AuthType
  email: string
  displayName: string
  senderName: string
  providerAccountId: string | null
  timezone: string
  dailyLimit: number
  currentDailyUsage: number
  healthScore: number | null
  healthStatus: MailboxHealth
  mailboxStatus: MailboxStatus
  verificationStatus: MailboxVerificationStatus
  warmupStatus: WarmupStatus
  lastVerifiedAt: string | null
  lastVerificationDurationMs: number | null
  lastVerificationResult: string | null
  deletedAt: string | null
  archivedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type MailboxPoolResponse = {
  id: string
  organizationId: string
  name: string
  description: string
  status: PoolStatus
  dailyPoolLimit: number
  sendingStrategy: SendingStrategy
  rotationStrategy: RotationStrategy
  maxConcurrentSends: number
  timezone: string
  memberCount: number
  healthAggregation: PoolHealthAggregation | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CreateMailboxPoolRequest = {
  name: string
  description?: string
  dailyPoolLimit?: number
  sendingStrategy?: SendingStrategy
  rotationStrategy?: RotationStrategy
  maxConcurrentSends?: number
  timezone?: string
  metadata?: Record<string, unknown>
}

export type UpdateMailboxPoolRequest = {
  name?: string
  description?: string
  status?: PoolStatus
  dailyPoolLimit?: number
  sendingStrategy?: SendingStrategy
  rotationStrategy?: RotationStrategy
  maxConcurrentSends?: number
  timezone?: string
  metadata?: Record<string, unknown>
}

export type PoolMembershipInput = {
  poolId: string
  mailboxIds: string[]
  role?: PoolMembershipRole
}

export type PoolBulkOperation = 'assign' | 'remove' | 'move' | 'clone' | 'archive'

export type PoolBulkRequest = {
  operation: PoolBulkOperation
  poolIds: string[]
  targetPoolId?: string
}

export type PoolAnalytics = {
  poolId: string
  healthTrend: { date: string; score: number }[]
  capacityUsage: { date: string; capacity: number; used: number }[]
  mailboxPerformance: { mailboxId: string; email: string; health: number; sent: number; deliverability: number }[]
  warmupProgress: { mailboxId: string; email: string; currentDay: number; totalDays: number; status: string }[]
}

export type OAuthConfigResponse = {
  id: string
  mailboxId: string
  provider: OAuthProvider
  providerAccountId: string
  scope: string
  tokenExpiresAt: string | null
  lastRotatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type SMTPConfigResponse = {
  id: string
  mailboxId: string
  smtpHost: string
  smtpPort: number
  encryption: SMTPEncryption
  username: string
  authenticationType: SMTPAuthenticationType
  validationStatus: ValidationStatus
  lastValidatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type IMAPConfigResponse = {
  id: string
  mailboxId: string
  host: string
  port: number
  ssl: boolean
  username: string
  authentication: 'password' | 'oauth2'
  validationStatus: ValidationStatus
  lastValidatedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ValidationResponse = {
  valid: boolean
  errors: string[]
}

export type CreateOAuthConfigRequest = {
  mailboxId: string
  provider: OAuthProvider
  providerAccountId: string
  encryptedRefreshToken?: string | null
  encryptedAccessToken?: string | null
  tokenExpiresAt?: string | null
  scope?: string
}

export type CreateSMTPConfigRequest = {
  mailboxId: string
  smtpHost: string
  smtpPort: number
  encryption: SMTPEncryption
  username: string
  encryptedPasswordReference: string
  authenticationType?: SMTPAuthenticationType
}

export type UpdateSMTPConfigRequest = {
  smtpHost?: string
  smtpPort?: number
  encryption?: SMTPEncryption
  username?: string
  encryptedPasswordReference?: string
  authenticationType?: SMTPAuthenticationType
}

export type CreateIMAPConfigRequest = {
  mailboxId: string
  host: string
  port: number
  ssl?: boolean
  authentication: 'password' | 'oauth2'
  username?: string
  password?: string
}

export type UpdateIMAPConfigRequest = {
  host?: string
  port?: number
  ssl?: boolean
  authentication?: 'password' | 'oauth2'
  username?: string
  password?: string
}

// ============================================================
// Warmup Engine — DTOs (Request / Response)
// ============================================================

export type CreateWarmupConfigRequest = {
  mailboxId: string
  templateId?: string
  startDate?: string
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

export type UpdateWarmupConfigRequest = {
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

export type WarmupConfigResponse = {
  id: string
  organizationId: string
  mailboxId: string
  mailboxEmail: string
  mailboxProvider: MailboxProvider
  status: WarmupConfigStatus
  stage: WarmupStage
  health: WarmupHealth
  startDate: string | null
  endDate: string | null
  currentDay: number
  totalDays: number
  initialSends: number
  maxDailySends: number
  dailyIncrease: number
  currentDailyTarget: number
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
  createdAt: string
  updatedAt: string
}

export type WarmupConfigWithStats = WarmupConfigResponse & {
  todayStats: WarmupDailyStats | null
  recentEvents: WarmupEvent[]
  activeNotifications: number
}

export type WarmupBulkOperation = 'pause' | 'resume' | 'archive' | 'delete'

export type WarmupBulkRequest = {
  operation: WarmupBulkOperation
  configIds: string[]
}

export type WarmupBulkResult = {
  configId: string
  success: boolean
  error?: string
}

export type WarmupDashboardStats = {
  totalConfigs: number
  running: number
  paused: number
  graduated: number
  totalMailboxesWarming: number
  avgHealthScore: number
  graduationRate: number
}

// ============================================================
// Mail Module — Filter / UI State
// ============================================================

export type MailNavItem = {
  key: string
  name: string
  href: string
  icon: string
  badge?: number
}

export type MailFilterState = {
  search: string
  status: MailboxStatus | 'all'
  provider: MailboxProvider | 'all'
  sortBy: 'email' | 'provider' | 'mailboxStatus' | 'healthScore' | 'createdAt'
  sortDirection: 'asc' | 'desc'
}

export type MailPoolFilterState = {
  search: string
  status: PoolStatus | 'all'
  sortBy: 'name' | 'status' | 'memberCount' | 'createdAt'
  sortDirection: 'asc' | 'desc'
}

export type MailCampaignFilterState = {
  search: string
  status: MailCampaignStatus | 'all'
  mailboxId: string | 'all'
  sortBy: 'name' | 'status' | 'sentCount' | 'createdAt'
  sortDirection: 'asc' | 'desc'
}

export type MailLeadFilterState = {
  search: string
  status: LeadStatus | 'all'
  source: string | 'all'
  sortBy: 'name' | 'email' | 'company' | 'status' | 'createdAt'
  sortDirection: 'asc' | 'desc'
}

// ============================================================
// Mail Module — API Result Wrappers
// ============================================================

export type MailApiSuccess<T> = { success: true; data: T }
export type MailApiError = { success: false; error: string }
export type MailApiResult<T> = MailApiSuccess<T> | MailApiError

// ============================================================
// Mail Module — Connection Wizard
// ============================================================

export type WizardStep = 'provider' | 'details' | 'review' | 'test' | 'complete'

export type WizardTestStatus = 'idle' | 'testing' | 'success' | 'failure'

export type WizardTestResult = {
  status: WizardTestStatus
  errorType?: 'timeout' | 'invalid_credentials' | 'server_unreachable' | 'ssl_error' | 'validation' | 'unknown'
  message?: string
  /** Discrete verification steps shown in the wizard (SMTP / send / IMAP / inbox read) */
  steps?: Array<{ name: string; passed: boolean; detail?: string }>
}

export type WizardSMTPValues = {
  smtpHost: string
  smtpPort: string
  smtpUsername: string
  smtpPassword: string
  encryption: SMTPEncryption
  authenticationType: SMTPAuthenticationType
}

export type WizardIMAPValues = {
  imapHost: string
  imapPort: string
  imapUsername: string
  imapPassword: string
  imapSsl: boolean
}

export type WizardValues = {
  email: string
  displayName: string
  senderName: string
  timezone: string
  dailyLimit: number
  smtp: WizardSMTPValues
  imap: WizardIMAPValues
}

export type WizardState = {
  currentStep: WizardStep
  provider: MailboxProvider | null
  values: WizardValues
  testResult: WizardTestResult
  stepErrors: Record<WizardStep, string[]>
}

export type ProviderInfo = {
  id: MailboxProvider
  name: string
  description: string
  authType: 'oauth' | 'smtp_imap'
  icon: string
}

// ============================================================
// Mail Module — Dashboard Types
// ============================================================

export type MailboxDashboardStats = {
  total: number
  connected: number
  needsAttention: number
  oauthExpired: number
  smtpErrors: number
  dailyCapacity: number
}

export type MailboxSortField =
  | 'email'
  | 'provider'
  | 'displayName'
  | 'mailboxStatus'
  | 'healthScore'
  | 'dailyLimit'
  | 'currentDailyUsage'
  | 'warmupStatus'
  | 'verificationStatus'
  | 'createdAt'
  | 'poolName'

export type MailboxPaginationState = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type MailboxTableRow = {
  id: string
  email: string
  displayName: string
  provider: MailboxProvider
  poolId: string | null
  poolName: string | null
  healthScore: number | null
  healthStatus: MailboxHealth
  mailboxStatus: MailboxStatus
  verificationStatus: MailboxVerificationStatus
  warmupStatus: WarmupStatus
  dailyLimit: number
  currentDailyUsage: number
  authType: AuthType
  createdAt: string
}

export type MailboxDetailDrawerState = {
  open: boolean
  mailboxId: string | null
}

export type BulkAction = 'assignPool' | 'enable' | 'disable' | 'archive' | 'delete' | 'restore' | 'verify' | 'reconnect'

// ============================================================
// Mail Module — Mailbox Lifecycle & Audit
// ============================================================

export type MailboxAuditAction =
  | 'created'
  | 'enabled'
  | 'disabled'
  | 'archived'
  | 'restored'
  | 'soft_deleted'
  | 'status_changed'
  | 'reconnect_attempted'
  | 'reconnect_succeeded'
  | 'reconnect_failed'
  | 'verified'
  | 'verification_failed'
  | 'pool_assigned'
  | 'pool_removed'
  | 'updated'
  | 'bulk_action'

export type MailboxAuditLogEntry = {
  id: string
  organizationId: string
  mailboxId: string
  actorUserId: string
  actorEmail: string
  action: MailboxAuditAction
  previousStatus: MailboxStatus | null
  newStatus: MailboxStatus | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type MailboxActionResult = {
  mailboxId: string
  success: boolean
  previousStatus: MailboxStatus | null
  newStatus: MailboxStatus | null
  error?: string
}

export type MailboxVerificationResult = {
  valid: boolean
  oauthValid: boolean | null
  smtpValid: boolean | null
  imapValid: boolean | null
  oauthError: string | null
  smtpError: string | null
  imapError: string | null
  verifiedAt: string
  durationMs: number
}

export type MailboxReconnectResult = {
  success: boolean
  newStatus: MailboxStatus
  oauthRedirectUrl?: string
  error?: string
}

export type MailboxFiltersState = {
  search: string
  status: MailboxStatus | 'all'
  provider: MailboxProvider | 'all'
  health: MailboxHealth | 'all'
  poolId: string | 'all'
  warmupStatus: WarmupStatus | 'all'
  sortBy: MailboxSortField
  sortDirection: 'asc' | 'desc'
  page: number
  pageSize: number
}

// ============================================================
// Mail Module — Error Codes
// ============================================================

export type MailErrorCode =
  | 'MAILBOX_NOT_FOUND'
  | 'MAILBOX_ALREADY_DISABLED'
  | 'MAILBOX_ALREADY_ARCHIVED'
  | 'MAILBOX_ALREADY_DELETED'
  | 'MAILBOX_NOT_ARCHIVED'
  | 'OAUTH_EXPIRED'
  | 'SMTP_AUTH_FAILED'
  | 'IMAP_UNAVAILABLE'
  | 'WORKSPACE_MISMATCH'
  | 'PERMISSION_DENIED'
  | 'NETWORK_TIMEOUT'
  | 'DATABASE_FAILURE'
  | 'INVALID_TRANSITION'
  | 'VALIDATION_FAILED'
  | 'POOL_NOT_FOUND'
  | 'CONFIG_NOT_FOUND'
  | 'DUPLICATE_MAILBOX'
  | 'NO_CONFIG_FOUND'
  | 'WARMUP_NOT_FOUND'
  | 'WARMUP_ALREADY_RUNNING'
  | 'WARMUP_ALREADY_PAUSED'
  | 'WARMUP_MAILBOX_NOT_VERIFIED'
  | 'WARMUP_DNS_NOT_VERIFIED'
  | 'WARMUP_GRADUATION_NOT_ALLOWED'
  | 'WARMUP_CONFIGURATION_INVALID'
  | 'WARMUP_DUPLICATE_ACTIVE'
  | 'WARMUP_FAILED'

export const MAIL_ERROR_MESSAGES: Record<MailErrorCode, string> = {
  MAILBOX_NOT_FOUND: 'The requested mailbox was not found.',
  MAILBOX_ALREADY_DISABLED: 'This mailbox is already disabled.',
  MAILBOX_ALREADY_ARCHIVED: 'This mailbox is already archived.',
  MAILBOX_ALREADY_DELETED: 'This mailbox is already deleted.',
  MAILBOX_NOT_ARCHIVED: 'This mailbox is not archived and cannot be restored.',
  OAUTH_EXPIRED: 'OAuth credentials have expired. Please reconnect via OAuth.',
  SMTP_AUTH_FAILED: 'SMTP authentication failed. Check your credentials.',
  IMAP_UNAVAILABLE: 'IMAP server is unavailable. Please try again later.',
  WORKSPACE_MISMATCH: 'This resource belongs to a different workspace.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  NETWORK_TIMEOUT: 'The connection timed out. Please try again.',
  DATABASE_FAILURE: 'A database error occurred. Please try again.',
  INVALID_TRANSITION: 'This state transition is not allowed.',
  VALIDATION_FAILED: 'The provided data failed validation.',
  POOL_NOT_FOUND: 'The requested pool was not found.',
  CONFIG_NOT_FOUND: 'The requested configuration was not found.',
  DUPLICATE_MAILBOX: 'A mailbox with this email already exists in this workspace.',
  NO_CONFIG_FOUND: 'No OAuth or SMTP configuration found for this mailbox.',
  WARMUP_NOT_FOUND: 'The requested warmup configuration was not found.',
  WARMUP_ALREADY_RUNNING: 'This warmup is already running.',
  WARMUP_ALREADY_PAUSED: 'This warmup is already paused.',
  WARMUP_MAILBOX_NOT_VERIFIED: 'The mailbox must be verified before starting warmup.',
  WARMUP_DNS_NOT_VERIFIED: 'DNS records must be verified before starting warmup.',
  WARMUP_GRADUATION_NOT_ALLOWED: 'Warmup cannot be graduated at this time.',
  WARMUP_CONFIGURATION_INVALID: 'The warmup configuration is invalid.',
  WARMUP_DUPLICATE_ACTIVE: 'An active warmup already exists for this mailbox.',
  WARMUP_FAILED: 'The warmup has failed and cannot continue.',
}

export function getMailErrorMessage(error: string): string {
  const lower = error.toLowerCase()
  if (lower.includes('pool') && lower.includes('not found')) return MAIL_ERROR_MESSAGES.POOL_NOT_FOUND
  if (lower.includes('warmup') && lower.includes('not found')) return MAIL_ERROR_MESSAGES.WARMUP_NOT_FOUND
  if (lower.includes('config') && lower.includes('not found')) return MAIL_ERROR_MESSAGES.CONFIG_NOT_FOUND
  if (lower.includes('not found')) return MAIL_ERROR_MESSAGES.MAILBOX_NOT_FOUND
  if (lower.includes('already disabled')) return MAIL_ERROR_MESSAGES.MAILBOX_ALREADY_DISABLED
  if (lower.includes('already archived')) return MAIL_ERROR_MESSAGES.MAILBOX_ALREADY_ARCHIVED
  if (lower.includes('already deleted')) return MAIL_ERROR_MESSAGES.MAILBOX_ALREADY_DELETED
  if (lower.includes('not archived')) return MAIL_ERROR_MESSAGES.MAILBOX_NOT_ARCHIVED
  if (lower.includes('warmup') && lower.includes('already running')) return MAIL_ERROR_MESSAGES.WARMUP_ALREADY_RUNNING
  if (lower.includes('warmup') && lower.includes('already paused')) return MAIL_ERROR_MESSAGES.WARMUP_ALREADY_PAUSED
  if (lower.includes('warmup') && lower.includes('duplicate')) return MAIL_ERROR_MESSAGES.WARMUP_DUPLICATE_ACTIVE
  if (lower.includes('warmup') && lower.includes('configuration invalid')) return MAIL_ERROR_MESSAGES.WARMUP_CONFIGURATION_INVALID
  if (lower.includes('oauth') && lower.includes('expired')) return MAIL_ERROR_MESSAGES.OAUTH_EXPIRED
  if (lower.includes('smtp') && lower.includes('auth')) return MAIL_ERROR_MESSAGES.SMTP_AUTH_FAILED
  if (lower.includes('imap') && lower.includes('unavail')) return MAIL_ERROR_MESSAGES.IMAP_UNAVAILABLE
  if (lower.includes('workspace') || lower.includes('mismatch')) return MAIL_ERROR_MESSAGES.WORKSPACE_MISMATCH
  if (lower.includes('permission') || lower.includes('denied')) return MAIL_ERROR_MESSAGES.PERMISSION_DENIED
  if (lower.includes('timeout')) return MAIL_ERROR_MESSAGES.NETWORK_TIMEOUT
  if (lower.includes('database') || lower.includes('db')) return MAIL_ERROR_MESSAGES.DATABASE_FAILURE
  if (lower.includes('transition')) return MAIL_ERROR_MESSAGES.INVALID_TRANSITION
  if (lower.includes('validation')) return MAIL_ERROR_MESSAGES.VALIDATION_FAILED
  if (lower.includes('duplicate') || lower.includes('already exists')) return MAIL_ERROR_MESSAGES.DUPLICATE_MAILBOX
  if (lower.includes('no oauth') || lower.includes('no smtp') || lower.includes('no config')) return MAIL_ERROR_MESSAGES.NO_CONFIG_FOUND
  return error
}

// ============================================================
// Mail Module — Permission Helpers
// ============================================================

export type MailUserPermissions = {
  canRead: boolean
  canWrite: boolean
  canManage: boolean
  canAdmin: boolean
}

export function hasMailPermission(permissions: MailUserPermissions | null, required: MailPermissionType): boolean {
  if (!permissions) return false
  switch (required) {
    case 'mail.read': return permissions.canRead
    case 'mail.write': return permissions.canWrite
    case 'mail.manage': return permissions.canManage
    case 'mail.admin': return permissions.canAdmin
    default: return false
  }
}

export function canPerformBulkAction(permissions: MailUserPermissions | null): boolean {
  return hasMailPermission(permissions, 'mail.manage')
}

export function canPerformAdminAction(permissions: MailUserPermissions | null): boolean {
  return hasMailPermission(permissions, 'mail.admin')
}

// ============================================================
// Warmup Execution Engine — Enums
// ============================================================

export type WarmupJobStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled'
  | 'skipped'

export type WarmupExecutionStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'failed'
  | 'skipped'

export type SchedulerStatus = 'stopped' | 'running' | 'paused'

export type RetryableErrorCategory =
  | 'timeout'
  | 'temporary_smtp'
  | 'temporary_imap'
  | 'network'
  | 'rate_limit'

export type NonRetryableErrorCategory =
  | 'invalid_credentials'
  | 'revoked_oauth'
  | 'permission_failure'
  | 'config_validation'

// ============================================================
// Warmup Execution Engine — Database Models
// ============================================================

export type WarmupJob = {
  id: string
  configId: string
  organizationId: string
  status: WarmupJobStatus
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  lastError: string | null
  errorCategory: string | null
  targetSends: number
  completedSends: number
  failedSends: number
  mailboxId: string
  poolId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type WarmupExecution = {
  id: string
  jobId: string
  configId: string
  organizationId: string
  status: WarmupExecutionStatus
  recipientEmail: string
  subject: string
  sentAt: string | null
  deliveredAt: string | null
  bouncedAt: string | null
  failedAt: string | null
  errorMessage: string | null
  smtpMessageId: string | null
  durationMs: number | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type WarmupMetrics = {
  executionsToday: number
  successRate: number
  failureRate: number
  avgExecutionDurationMs: number
  mailboxUtilization: number
  poolUtilization: number
  schedulerStatus: SchedulerStatus
  lastHeartbeat: string | null
  queuedJobs: number
  runningJobs: number
  failedJobs: number
  totalJobsToday: number
}

export type SchedulerHealth = {
  status: SchedulerStatus
  lastHeartbeat: string | null
  uptime: number
  lastRunAt: string | null
  lastRunDurationMs: number | null
  configsProcessed: number
  jobsCreated: number
  errorsCount: number
}

export type WarmupNotificationEventType =
  | 'warmup_completed'
  | 'warmup_graduated'
  | 'warmup_paused'
  | 'health_degraded'
  | 'mailbox_disconnected'
  | 'oauth_expired'
  | 'dns_failure'
  | 'execution_failed'
  | 'scheduler_started'
  | 'scheduler_stopped'
  | 'recovery_triggered'

// ============================================================
// Warmup Execution Engine — DTOs
// ============================================================

export type WarmupExecutionResponse = {
  id: string
  jobId: string
  configId: string
  status: WarmupExecutionStatus
  recipientEmail: string
  subject: string
  sentAt: string | null
  deliveredAt: string | null
  errorMessage: string | null
  durationMs: number | null
  createdAt: string
}

export type WarmupJobResponse = {
  id: string
  configId: string
  status: WarmupJobStatus
  scheduledAt: string
  startedAt: string | null
  completedAt: string | null
  retryCount: number
  maxRetries: number
  targetSends: number
  completedSends: number
  failedSends: number
  lastError: string | null
  createdAt: string
}

export type WarmupMetricsResponse = WarmupMetrics

export type SchedulerHealthResponse = SchedulerHealth

export type WarmupQueueItem = {
  jobId: string
  configId: string
  organizationId: string
  scheduledAt: string
  priority: number
}

export type WarmupAuditAction =
  | 'scheduler_started'
  | 'scheduler_stopped'
  | 'scheduler_paused'
  | 'scheduler_resumed'
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'execution_retry'
  | 'execution_cancelled'
  | 'execution_skipped'
  | 'recovery_triggered'
  | 'job_created'
  | 'job_completed'
