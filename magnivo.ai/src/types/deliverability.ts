// ============================================================
// Deliverability Center — Enums
// ============================================================

export type DnsRecordStatus = 'unverified' | 'valid' | 'invalid' | 'missing'

export type DomainHealthLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

export type DnsRecordType = 'TXT' | 'CNAME' | 'MX' | 'A'

export type VerificationSource = 'manual' | 'auto' | 'monitoring' | 'bulk'

export type VerificationResult = 'pending' | 'success' | 'failure'

export type NotificationType =
  | 'spf_break'
  | 'dkim_expired'
  | 'dmarc_removed'
  | 'tracking_stopped'
  | 'health_degraded'
  | 'dns_timeout'

export type NotificationSeverity = 'info' | 'warning' | 'critical'

export type TrackingDomainStatus = 'unverified' | 'verified' | 'failed' | 'expired'

export type BulkJobStatus = 'pending' | 'running' | 'completed' | 'failed'

export type DnsProvider = 'cloudflare' | 'route53' | 'godaddy' | 'namecheap' | 'squarespace' | 'zoho' | 'google' | 'other'

// ============================================================
// Deliverability Center — Database Models
// ============================================================

export type DomainPurpose = 'sending' | 'tracking' | 'warmup' | 'shared'

export type DeliverabilityDomain = {
  id: string
  organizationId: string
  domain: string
  healthScore: number
  healthStatus: DomainHealthLevel
  spfStatus: DnsRecordStatus
  dkimStatus: DnsRecordStatus
  dmarcStatus: DnsRecordStatus
  trackingStatus: DnsRecordStatus
  returnPathStatus: DnsRecordStatus
  mxStatus: DnsRecordStatus
  bimiStatus: DnsRecordStatus | 'not_configured'
  dkimSelector: string
  dkimCnameTarget: string | null
  spfRaw: string | null
  dmarcRaw: string | null
  dmarcPolicy: string | null
  trackingDomain: string | null
  trackingCnameTarget: string | null
  returnPathDomain: string | null
  returnPathCnameTarget: string | null
  purpose: DomainPurpose
  tags: string[]
  notes: string
  dnsProvider: DnsProvider | null
  ownershipVerified: boolean
  ownershipVerifiedAt: string | null
  bimiSelector: string
  bimiSvgUrl: string | null
  bimiVmcUrl: string | null
  lastCheckedAt: string | null
  nextCheckAt: string | null
  checkIntervalHours: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type DnsRecord = {
  id: string
  domainId: string
  recordType: DnsRecordType
  recordName: string
  recordValue: string
  ttl: number | null
  isActive: boolean
  verifiedAt: string | null
  createdAt: string
  updatedAt: string
}

export type VerificationHistoryEntry = {
  id: string
  domainId: string
  organizationId: string
  recordType: string
  previousValue: string | null
  newValue: string | null
  previousStatus: string | null
  newStatus: string | null
  action: string
  actorUserId: string | null
  actorEmail: string | null
  verifiedBy: VerificationSource
  result: VerificationResult
  errorMessage: string | null
  durationMs: number | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type TrackingDomain = {
  id: string
  organizationId: string
  domainId: string
  trackingDomain: string
  cnameTarget: string | null
  status: TrackingDomainStatus
  lastVerifiedAt: string | null
  expiresAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type DeliverabilityNotification = {
  id: string
  organizationId: string
  domainId: string
  notificationType: NotificationType
  title: string
  message: string
  severity: NotificationSeverity
  isRead: boolean
  isDismissed: boolean
  previousValue: string | null
  newValue: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type BulkVerificationJob = {
  id: string
  organizationId: string
  actorUserId: string
  actorEmail: string
  status: BulkJobStatus
  totalDomains: number
  completedDomains: number
  successCount: number
  failureCount: number
  startedAt: string | null
  completedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

// ============================================================
// Deliverability Center — DNS Lookup Results
// ============================================================

export type SpfLookupResult = {
  found: boolean
  raw: string | null
  includes: string[]
  valid: boolean
  errors: string[]
  warnings: string[]
}

export type DkimLookupResult = {
  found: boolean
  record: string | null
  selector: string
  keyLength: number | null
  valid: boolean
  errors: string[]
}

export type DmarcLookupResult = {
  found: boolean
  raw: string | null
  policy: string | null
  alignment: string | null
  rua: string | null
  ruf: string | null
  valid: boolean
  errors: string[]
}

export type TrackingLookupResult = {
  found: boolean
  cnameTarget: string | null
  valid: boolean
  errors: string[]
}

export type DomainVerificationResult = {
  domain: string
  spf: SpfLookupResult
  dkim: DkimLookupResult
  dmarc: DmarcLookupResult
  tracking: TrackingLookupResult
  returnPath: TrackingLookupResult
  healthScore: number
  healthStatus: DomainHealthLevel
  verifiedAt: string
  durationMs: number
}

// ============================================================
// Deliverability Center — DTOs
// ============================================================

export type CreateDomainRequest = {
  domain: string
  dkimSelector?: string
  checkIntervalHours?: number
  purpose?: DomainPurpose
  tags?: string[]
  notes?: string
  dnsProvider?: DnsProvider
}

export type VerifyDomainRequest = {
  domainId: string
  source?: VerificationSource
}

export type BulkVerifyRequest = {
  domainIds: string[]
}

export type UpdateDomainRequest = {
  dkimSelector?: string
  checkIntervalHours?: number
  trackingDomain?: string
  returnPathDomain?: string
  purpose?: DomainPurpose
  tags?: string[]
  notes?: string
  dnsProvider?: DnsProvider | null
  ownershipVerified?: boolean
  bimiSelector?: string
  bimiSvgUrl?: string | null
  bimiVmcUrl?: string | null
}

export type DomainHealthBreakdown = {
  spf: number
  dkim: number
  dmarc: number
  tracking: number
  overall: number
}

// ============================================================
// Deliverability Center — Filter / UI State
// ============================================================

export type DeliverabilityFilterState = {
  search: string
  healthStatus: DomainHealthLevel | 'all'
  spfStatus: DnsRecordStatus | 'all'
  dkimStatus: DnsRecordStatus | 'all'
  dmarcStatus: DnsRecordStatus | 'all'
  sortBy: 'domain' | 'healthScore' | 'lastCheckedAt' | 'createdAt'
  sortDirection: 'asc' | 'desc'
  selectedDomains: string[]
  expandedDomainId: string | null
  showHistory: boolean
  showProviderInstructions: boolean
  selectedProvider: DnsProvider | null
}

// ============================================================
// Deliverability Center — API Result Wrappers
// ============================================================

export type DeliverabilityApiSuccess<T> = { success: true; data: T }
export type DeliverabilityApiError = { success: false; error: string }
export type DeliverabilityApiResult<T> = DeliverabilityApiSuccess<T> | DeliverabilityApiError

// ============================================================
// Deliverability Center — Dashboard Stats
// ============================================================

export type DeliverabilityDashboardStats = {
  totalDomains: number
  healthyDomains: number
  needsAttention: number
  failedDomains: number
  avgHealthScore: number
  unreadNotifications: number
}

// ============================================================
// Deliverability Center — Provider Instructions
// ============================================================

export type ProviderDnsInstruction = {
  provider: DnsProvider
  providerName: string
  recordType: string
  host: string
  value: string
  ttl: number
  notes: string
  steps: string[]
}

// ============================================================
// Return Path Management
// ============================================================

export type ReturnPathStatus = 'pending' | 'active' | 'failed' | 'expired' | 'rotating'

export type ReturnPath = {
  id: string
  organizationId: string
  domainId: string
  returnPathDomain: string
  cnameTarget: string | null
  status: ReturnPathStatus
  isDefault: boolean
  lastVerifiedAt: string | null
  expiresAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type ReturnPathAuditEntry = {
  id: string
  returnPathId: string
  organizationId: string
  action: string
  actorUserId: string | null
  actorEmail: string | null
  previousValue: string | null
  newValue: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type CreateReturnPathRequest = {
  domainId: string
  returnPathDomain: string
  cnameTarget?: string
  isDefault?: boolean
}

export type UpdateReturnPathRequest = {
  cnameTarget?: string
  isDefault?: boolean
}

// ============================================================
// DKIM Selector Management
// ============================================================

export type DkimSelectorStatus = 'active' | 'inactive' | 'pending' | 'expired' | 'failed'

export type DkimSelector = {
  id: string
  organizationId: string
  domainId: string
  selector: string
  status: DkimSelectorStatus
  publicKey: string | null
  keyLength: number | null
  lastVerifiedAt: string | null
  expiresAt: string | null
  rotatedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type DkimSelectorHistoryEntry = {
  id: string
  selectorId: string
  domainId: string
  organizationId: string
  action: string
  previousSelector: string | null
  newSelector: string | null
  keyLength: number | null
  verifiedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type CreateDkimSelectorRequest = {
  domainId: string
  selector: string
}

export type RotateDkimRequest = {
  domainId: string
  currentSelectorId: string
  newSelector: string
}

// ============================================================
// Blacklist Monitoring
// ============================================================

export type BlacklistName = 'spamhaus' | 'barracuda' | 'uceprotect' | 'spamcop' | 'surbl' | 'multirbl'

export type BlacklistStatus = 'clean' | 'listed' | 'unknown' | 'timeout'

export type BlacklistCheck = {
  id: string
  organizationId: string
  domainId: string
  blacklistName: BlacklistName
  status: BlacklistStatus
  ip: string | null
  listedAt: string | null
  delistedAt: string | null
  checkResult: string | null
  durationMs: number | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type BlacklistOverview = {
  domainId: string
  domain: string
  totalChecks: number
  listedCount: number
  cleanCount: number
  lastCheckedAt: string | null
  checks: BlacklistCheck[]
}

export type BlacklistDashboardStats = {
  totalDomainsChecked: number
  cleanDomains: number
  listedDomains: number
  unknownDomains: number
  recentListings: BlacklistCheck[]
}

// ============================================================
// Reputation Monitoring
// ============================================================

export type ReputationLevel = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

export type ReputationSource = 'google_postmaster' | 'microsoft_snds' | 'internal' | 'manual'

export type DomainReputation = {
  id: string
  organizationId: string
  domainId: string
  source: ReputationSource
  reputationScore: number
  reputationLevel: ReputationLevel
  sendingVolume: number | null
  bounceRate: number | null
  complaintRate: number | null
  openRate: number | null
  metadata: Record<string, unknown>
  recordedAt: string
  createdAt: string
}

export type MailboxReputation = {
  id: string
  organizationId: string
  mailboxId: string
  domainId: string
  source: ReputationSource
  reputationScore: number
  reputationLevel: ReputationLevel
  sendingVolume: number | null
  bounceRate: number | null
  complaintRate: number | null
  metadata: Record<string, unknown>
  recordedAt: string
  createdAt: string
}

export type ReputationTrend = {
  date: string
  score: number
  level: ReputationLevel
}

export type ReputationDashboardStats = {
  domainsTracked: number
  avgReputationScore: number
  improvingDomains: number
  decliningDomains: number
  recentEntries: DomainReputation[]
}

// ============================================================
// Complaint Monitoring
// ============================================================

export type ComplaintStatus = 'new' | 'investigating' | 'resolved' | 'dismissed'

export type ComplaintRecord = {
  id: string
  organizationId: string
  domainId: string
  mailboxId: string | null
  campaignId: string | null
  complaintType: string
  source: string
  status: ComplaintStatus
  autoPausedMailbox: boolean
  notifiedWorkspace: boolean
  resolvedAt: string | null
  resolvedBy: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type ComplaintDashboardStats = {
  totalComplaints: number
  activeComplaints: number
  resolvedComplaints: number
  autoPausedMailboxes: number
  recentComplaints: ComplaintRecord[]
}

// ============================================================
// Bounce Intelligence
// ============================================================

export type BounceType = 'hard' | 'soft' | 'unknown'
export type BounceCategory = 'invalid_email' | 'mailbox_full' | 'domain_not_found' | 'rejected' | 'timeout' | 'content_rejected' | 'too_many_recipients' | 'network_error' | 'other'

export type BounceRecord = {
  id: string
  organizationId: string
  domainId: string
  mailboxId: string | null
  campaignId: string | null
  recipientEmail: string
  bounceType: BounceType
  bounceCategory: BounceCategory
  smtpCode: string | null
  diagnosticCode: string | null
  retryCount: number
  nextRetryAt: string | null
  suppressed: boolean
  metadata: Record<string, unknown>
  createdAt: string
}

export type BounceDashboardStats = {
  totalBounces: number
  hardBounces: number
  softBounces: number
  unknownBounces: number
  suppressionCount: number
  recentBounces: BounceRecord[]
}

// ============================================================
// Google Postmaster Integration
// ============================================================

export type PostmasterConnectionStatus = 'disconnected' | 'connected' | 'error' | 'pending_verification'

export type PostmasterDomainStatus = 'pending' | 'verified' | 'failed'

export type PostmasterDomain = {
  id: string
  organizationId: string
  domainId: string | null
  postmasterDomain: string
  connectionStatus: PostmasterConnectionStatus
  domainVerificationStatus: PostmasterDomainStatus
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type PostmasterMetrics = {
  id: string
  postmasterDomainId: string
  organizationId: string
  spamComplaintRate: number
  ipReputation: string | null
  domainReputation: string | null
  authenticationSuccess: number
  DKIMSuccessRate: number
  SPFSuccessRate: number
  DMARCSuccessRate: number
  userReportedSpam: number
  date: string
  createdAt: string
}

export type PostmasterDashboardStats = {
  domainsConnected: number
  domainsVerified: number
  lastSyncAt: string | null
  avgSpamComplaintRate: number
  avgAuthSuccessRate: number
  domainReputationBreakdown: { level: string; count: number }[]
}

// ============================================================
// Microsoft SNDS Integration
// ============================================================

export type SndsConnectionStatus = 'disconnected' | 'connected' | 'error'

export type SndsDomain = {
  id: string
  organizationId: string
  domainId: string | null
  sndsDomain: string
  connectionStatus: SndsConnectionStatus
  accessToken: string | null
  refreshToken: string | null
  tokenExpiresAt: string | null
  lastSyncAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type SndsMetrics = {
  id: string
  sndsDomainId: string
  organizationId: string
  spamComplaintRate: number
  trapHits: number
  ipReputation: string | null
  malwareCount: number
  networkSpamCount: number
  date: string
  createdAt: string
}

export type SndsDashboardStats = {
  domainsConnected: number
  lastSyncAt: string | null
  avgComplaintRate: number
  totalTrapHits: number
  recentMetrics: SndsMetrics[]
}

// ============================================================
// Tracking Infrastructure
// ============================================================

export type TrackingTokenType = 'open' | 'click'

export type TrackingToken = {
  id: string
  organizationId: string
  campaignId: string | null
  mailboxId: string | null
  token: string
  tokenType: TrackingTokenType
  recipientEmail: string | null
  expiresAt: string | null
  usedAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type TrackingPixelEvent = {
  id: string
  organizationId: string
  trackingTokenId: string
  campaignId: string | null
  mailboxId: string | null
  recipientEmail: string
  userAgent: string | null
  ipAddress: string | null
  country: string | null
  createdAt: string
}

export type ClickEvent = {
  id: string
  organizationId: string
  trackingTokenId: string
  campaignId: string | null
  mailboxId: string | null
  recipientEmail: string
  originalUrl: string
  redirectUrl: string | null
  userAgent: string | null
  ipAddress: string | null
  country: string | null
  createdAt: string
}

export type TrackingDashboardStats = {
  totalOpens: number
  uniqueOpens: number
  totalClicks: number
  uniqueClicks: number
  openRate: number
  clickRate: number
  recentEvents: (TrackingPixelEvent | ClickEvent)[]
}

// ============================================================
// Monitoring Scheduler
// ============================================================

export type MonitoringJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export type MonitoringJobType = 'dns_verification' | 'blacklist_check' | 'reputation_check' | 'postmaster_sync' | 'snds_sync' | 'cleanup'

export type MonitoringJob = {
  id: string
  organizationId: string
  jobType: MonitoringJobType
  status: MonitoringJobStatus
  domainId: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  error: string | null
  retryCount: number
  maxRetries: number
  nextRetryAt: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type MonitoringConfig = {
  id: string
  organizationId: string
  dnsVerificationEnabled: boolean
  blacklistCheckEnabled: boolean
  reputationMonitoringEnabled: boolean
  postmasterSyncEnabled: boolean
  sndsSyncEnabled: boolean
  dnsCheckIntervalHours: number
  blacklistCheckIntervalHours: number
  reputationCheckIntervalHours: number
  postmasterSyncIntervalHours: number
  sndsSyncIntervalHours: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ============================================================
// Workspace Isolation
// ============================================================

export type WorkspaceDeliverabilitySummary = {
  organizationId: string
  totalDomains: number
  totalTrackingDomains: number
  totalReturnPaths: number
  totalDkimSelectors: number
  monitoredDomains: number
  blacklistAlerts: number
  activeComplaints: number
  suppressionCount: number
}
