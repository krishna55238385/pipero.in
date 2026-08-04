// ============================================================
// Campaign Domain — Enums
// ============================================================

export type CampaignStatus = 'draft' | 'active' | 'scheduled' | 'running' | 'paused' | 'stopped' | 'completed' | 'archived' | 'failed'

export type NodeType = 'start' | 'email' | 'wait' | 'condition' | 'split' | 'goal' | 'webhook' | 'delay' | 'exit'

export type VariantType = 'A' | 'B' | 'C'

export type TriggerType = 'manual' | 'scheduled' | 'api' | 'webhook'

export type SequenceStatus = 'draft' | 'active' | 'paused' | 'completed'

export type GoalType = 'open_rate' | 'click_rate' | 'reply_rate' | 'bounce_rate' | 'custom'

// ============================================================
// Campaign Domain — Database Models
// ============================================================

export type CampaignFolder = {
  id: string
  organizationId: string
  name: string
  description: string
  parentId: string | null
  sortOrder: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type CampaignTag = {
  id: string
  organizationId: string
  name: string
  color: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignLabel = {
  id: string
  organizationId: string
  name: string
  color: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type Campaign = {
  id: string
  organizationId: string
  folderId: string | null
  name: string
  description: string
  status: CampaignStatus
  subject: string
  bodyHtml: string
  bodyText: string
  previewText: string
  fromName: string
  fromEmail: string
  replyTo: string
  poolId: string | null
  timezone: string
  triggerType: TriggerType
  ownerId: string | null
  version: number
  isDeleted: boolean
  deletedAt: string | null
  archivedAt: string | null
  scheduledAt: string | null
  startedAt: string | null
  stoppedAt: string | null
  completedAt: string | null
  lastPausedAt: string | null
  recipientCount: number
  sentCount: number
  openCount: number
  clickCount: number
  replyCount: number
  bounceCount: number
  unsubscribeCount: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  tags?: CampaignTag[]
  labels?: CampaignLabel[]
}

export type CampaignVersion = {
  id: string
  campaignId: string
  organizationId: string
  versionNumber: number
  snapshot: Record<string, unknown>
  changeSummary: string
  actorUserId: string | null
  actorEmail: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type CampaignSchedule = {
  id: string
  campaignId: string
  organizationId: string
  scheduledAt: string
  timezone: string
  recurrence: string | null
  recurrenceEndAt: string | null
  isActive: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignSettings = {
  id: string
  campaignId: string
  organizationId: string
  openTracking: boolean
  clickTracking: boolean
  unsubscribeLink: boolean
  sendWindowStart: number
  sendWindowEnd: number
  maxSendsPerDay: number
  throttleMs: number
  abTestEnabled: boolean
  abTestPercentage: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignStatistics = {
  id: string
  campaignId: string
  organizationId: string
  date: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  replied: number
  bounced: number
  unsubscribed: number
  complaints: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignHistory = {
  id: string
  campaignId: string
  organizationId: string
  action: string
  actorUserId: string | null
  actorEmail: string | null
  previousStatus: string | null
  newStatus: string | null
  changeSummary: string
  previousData: Record<string, unknown> | null
  newData: Record<string, unknown> | null
  metadata: Record<string, unknown>
  createdAt: string
}

export type CampaignEvent = {
  id: string
  campaignId: string
  organizationId: string
  eventType: string
  actorUserId: string | null
  actorEmail: string | null
  previousStatus: string | null
  newStatus: string | null
  message: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type CampaignGoal = {
  id: string
  campaignId: string
  organizationId: string
  name: string
  goalType: GoalType
  targetValue: number
  currentValue: number
  isMet: boolean
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignTemplate = {
  id: string
  organizationId: string
  name: string
  description: string
  category: string
  subject: string
  bodyHtml: string
  bodyText: string
  previewText: string
  fromName: string
  fromEmail: string
  settings: Record<string, unknown>
  isSystem: boolean
  useCount: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type CampaignAttachment = {
  id: string
  campaignId: string
  organizationId: string
  filename: string
  mimeType: string
  fileSize: number
  storagePath: string
  metadata: Record<string, unknown>
  createdAt: string
}

export type CampaignMetadata = {
  id: string
  campaignId: string
  organizationId: string
  key: string
  value: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignSequence = {
  id: string
  campaignId: string
  organizationId: string
  name: string
  description: string
  status: SequenceStatus
  version: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  steps?: CampaignSequenceStep[]
}

export type CampaignSequenceStep = {
  id: string
  sequenceId: string
  organizationId: string
  stepNumber: number
  subject: string
  bodyHtml: string
  bodyText: string
  delayDays: number
  delayHours: number
  conditionType: string | null
  conditionConfig: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignNode = {
  id: string
  campaignId: string
  organizationId: string
  nodeType: NodeType
  label: string
  positionX: number
  positionY: number
  config: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignNodeEdge = {
  id: string
  campaignId: string
  organizationId: string
  sourceNodeId: string
  targetNodeId: string
  label: string
  sortOrder: number
  metadata: Record<string, unknown>
  createdAt: string
}

export type CampaignNodeCondition = {
  id: string
  nodeId: string
  organizationId: string
  conditionType: string
  field: string
  operator: string
  value: string
  sortOrder: number
  metadata: Record<string, unknown>
  createdAt: string
}

export type CampaignVariant = {
  id: string
  campaignId: string
  organizationId: string
  variantType: VariantType
  name: string
  subject: string
  bodyHtml: string
  bodyText: string
  percentage: number
  isWinner: boolean
  sentCount: number
  openCount: number
  clickCount: number
  replyCount: number
  bounceCount: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ============================================================
// Campaign Domain — DTOs (Request / Response)
// ============================================================

export type CreateCampaignRequest = {
  name: string
  description?: string
  folderId?: string | null
  subject?: string
  bodyHtml?: string
  bodyText?: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  poolId?: string | null
  timezone?: string
  triggerType?: TriggerType
  tagIds?: string[]
  labelIds?: string[]
  metadata?: Record<string, unknown>
}

export type UpdateCampaignRequest = {
  name?: string
  description?: string
  folderId?: string | null
  subject?: string
  bodyHtml?: string
  bodyText?: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  poolId?: string | null
  timezone?: string
  triggerType?: TriggerType
  tagIds?: string[]
  labelIds?: string[]
  version?: number
  metadata?: Record<string, unknown>
}

export type CampaignResponse = {
  id: string
  organizationId: string
  folderId: string | null
  folderName: string | null
  name: string
  description: string
  status: CampaignStatus
  subject: string
  bodyHtml: string
  bodyText: string
  previewText: string
  fromName: string
  fromEmail: string
  replyTo: string
  poolId: string | null
  poolName: string | null
  timezone: string
  triggerType: TriggerType
  ownerId: string | null
  version: number
  archivedAt: string | null
  scheduledAt: string | null
  startedAt: string | null
  stoppedAt: string | null
  completedAt: string | null
  recipientCount: number
  sentCount: number
  openCount: number
  clickCount: number
  replyCount: number
  bounceCount: number
  unsubscribeCount: number
  tags: CampaignTag[]
  labels: CampaignLabel[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type CampaignListResponse = {
  campaigns: CampaignResponse[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type CampaignSearchRequest = {
  search?: string
  status?: CampaignStatus | 'all'
  folderId?: string | 'all'
  tagId?: string | 'all'
  labelId?: string | 'all'
  ownerId?: string | 'all'
  poolId?: string | 'all'
  sortBy?: 'name' | 'status' | 'sentCount' | 'createdAt' | 'updatedAt'
  sortDirection?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export type CampaignBulkOperation = 'archive' | 'delete' | 'pause' | 'resume'

export type CampaignBulkRequest = {
  operation: CampaignBulkOperation
  campaignIds: string[]
}

export type CampaignBulkResult = {
  campaignId: string
  success: boolean
  error?: string
}

export type CampaignDashboardStats = {
  totalCampaigns: number
  draft: number
  scheduled: number
  running: number
  paused: number
  completed: number
  archived: number
  failed: number
  totalSent: number
  totalOpened: number
  totalClicked: number
  avgOpenRate: number
  avgClickRate: number
}

export type CreateFolderRequest = {
  name: string
  description?: string
  parentId?: string | null
}

export type UpdateFolderRequest = {
  name?: string
  description?: string
  parentId?: string | null
  sortOrder?: number
}

export type CreateTemplateRequest = {
  name: string
  description?: string
  category?: string
  subject?: string
  bodyHtml?: string
  bodyText?: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  settings?: Record<string, unknown>
}

export type UpdateTemplateRequest = {
  name?: string
  description?: string
  category?: string
  subject?: string
  bodyHtml?: string
  bodyText?: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  settings?: Record<string, unknown>
}

// ============================================================
// Campaign Domain — Audit Actions
// ============================================================

export type CampaignAuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'archived'
  | 'duplicated'
  | 'paused'
  | 'resumed'
  | 'launched'
  | 'restored'
  | 'template_applied'
  | 'version_created'
  | 'rollback'
  | 'folder_moved'
  | 'bulk_action'
  | 'tags_updated'
  | 'labels_updated'
  | 'schedule_created'
  | 'schedule_updated'

// ============================================================
// Campaign Domain — Filter State
// ============================================================

export type CampaignFilterState = {
  search: string
  status: CampaignStatus | 'all'
  folderId: string | 'all'
  tagId: string | 'all'
  labelId: string | 'all'
  ownerId: string | 'all'
  poolId: string | 'all'
  sortBy: 'name' | 'status' | 'sentCount' | 'createdAt' | 'updatedAt'
  sortDirection: 'asc' | 'desc'
  page: number
  pageSize: number
}

// ============================================================
// Campaign Domain — Permission Types
// ============================================================

export type CampaignPermissionType =
  | 'campaign.read'
  | 'campaign.write'
  | 'campaign.manage'
  | 'campaign.admin'

export type CampaignPermissions = {
  canRead: boolean
  canWrite: boolean
  canManage: boolean
  canAdmin: boolean
}

// ============================================================
// Campaign Domain — API Result Wrappers
// ============================================================

export type CampaignApiSuccess<T> = { success: true; data: T }
export type CampaignApiError = { success: false; error: string }
export type CampaignApiResult<T> = CampaignApiSuccess<T> | CampaignApiError

// ============================================================
// Campaign Domain — Error Codes
// ============================================================

export type CampaignErrorCode =
  | 'CAMPAIGN_NOT_FOUND'
  | 'CAMPAIGN_ALREADY_EXISTS'
  | 'CAMPAIGN_INVALID_STATUS'
  | 'CAMPAIGN_VALIDATION_FAILED'
  | 'CAMPAIGN_POOL_NOT_FOUND'
  | 'CAMPAIGN_POOL_UNHEALTHY'
  | 'CAMPAIGN_POOL_INACTIVE'
  | 'CAMPAIGN_FOLDER_NOT_FOUND'
  | 'CAMPAIGN_TEMPLATE_NOT_FOUND'
  | 'CAMPAIGN_VERSION_CONFLICT'
  | 'CAMPAIGN_CANNOT_DELETE'
  | 'CAMPAIGN_CANNOT_ARCHIVE'
  | 'CAMPAIGN_CANNOT_PAUSE'
  | 'CAMPAIGN_CANNOT_RESUME'
  | 'CAMPAIGN_DATABASE_FAILURE'

export const CAMPAIGN_ERROR_MESSAGES: Record<CampaignErrorCode, string> = {
  CAMPAIGN_NOT_FOUND: 'The requested campaign was not found.',
  CAMPAIGN_ALREADY_EXISTS: 'A campaign with this name already exists in this folder.',
  CAMPAIGN_INVALID_STATUS: 'This campaign status does not allow this operation.',
  CAMPAIGN_VALIDATION_FAILED: 'The campaign data failed validation.',
  CAMPAIGN_POOL_NOT_FOUND: 'The assigned mailbox pool was not found.',
  CAMPAIGN_POOL_UNHEALTHY: 'The mailbox pool is not healthy enough to run this campaign.',
  CAMPAIGN_POOL_INACTIVE: 'The mailbox pool is inactive.',
  CAMPAIGN_FOLDER_NOT_FOUND: 'The specified folder was not found.',
  CAMPAIGN_TEMPLATE_NOT_FOUND: 'The specified template was not found.',
  CAMPAIGN_VERSION_CONFLICT: 'The campaign has been modified by another user. Please refresh and try again.',
  CAMPAIGN_CANNOT_DELETE: 'This campaign cannot be deleted in its current status.',
  CAMPAIGN_CANNOT_ARCHIVE: 'This campaign cannot be archived in its current status.',
  CAMPAIGN_CANNOT_PAUSE: 'This campaign cannot be paused in its current status.',
  CAMPAIGN_CANNOT_RESUME: 'This campaign cannot be resumed in its current status.',
  CAMPAIGN_DATABASE_FAILURE: 'A database error occurred. Please try again.',
}

export function getCampaignErrorMessage(error: string): string {
  const lower = error.toLowerCase()
  if (lower.includes('pool') && lower.includes('not found')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_POOL_NOT_FOUND
  if (lower.includes('pool') && lower.includes('unhealthy')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_POOL_UNHEALTHY
  if (lower.includes('pool') && lower.includes('inactive')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_POOL_INACTIVE
  if (lower.includes('folder') && lower.includes('not found')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_FOLDER_NOT_FOUND
  if (lower.includes('template') && lower.includes('not found')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_TEMPLATE_NOT_FOUND
  if (lower.includes('version') && lower.includes('conflict')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_VERSION_CONFLICT
  if (lower.includes('cannot delete')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_DELETE
  if (lower.includes('cannot archive')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_ARCHIVE
  if (lower.includes('cannot pause')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_PAUSE
  if (lower.includes('cannot resume')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_RESUME
  if (lower.includes('database') || lower.includes('db')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE
  if (lower.includes('permission') || lower.includes('denied')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_VALIDATION_FAILED
  if (lower.includes('not found')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND
  if (lower.includes('already exists') || lower.includes('duplicate')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_ALREADY_EXISTS
  if (lower.includes('invalid status') || lower.includes('status')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_INVALID_STATUS
  if (lower.includes('validation')) return CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_VALIDATION_FAILED
  return error
}

// ============================================================
// Campaign Builder — Extended Types
// ============================================================

export type CampaignNodeType = NodeType | 'ai_send' | 'crm_update' | 'slack_notify' | 'http_request'

export type CampaignSeverity = 'error' | 'warning' | 'info'

export type CampaignNodeValidationErrors = {
  nodeId: string
  errors: string[]
}

export type CampaignBuilderNodeData = {
  nodeType: CampaignNodeType
  label: string
  subject?: string
  body?: string
  duration?: number
  unit?: string
  field?: string
  operator?: string
  value?: string
  url?: string
  method?: string
  goalName?: string
  goalType?: string
  percentages?: number[]
  templateId?: string | null
  abEnabled?: boolean
  config?: Record<string, unknown>
}

export type CampaignBuilderNode = {
  id: string
  type: string
  position: { x: number; y: number }
  data: CampaignBuilderNodeData
}

export type CampaignBuilderEdge = {
  id: string
  source: string
  target: string
  label?: string
  animated?: boolean
  type?: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type CampaignRecord = CampaignResponse & {
  sequences?: (CampaignSequence & { steps?: CampaignSequenceStep[] })[]
  nodes?: CampaignNode[]
  edges?: CampaignNodeEdge[]
  conditions?: CampaignNodeCondition[]
  variants?: CampaignVariant[]
}
