import type { CampaignStatus, CampaignAuditAction } from '@/types/campaign'

const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active', 'scheduled', 'running', 'paused', 'archived', 'failed'],
  active: ['running', 'paused', 'stopped', 'archived', 'failed'],
  scheduled: ['running', 'paused', 'stopped', 'draft', 'archived', 'failed'],
  running: ['paused', 'stopped', 'completed', 'archived', 'failed'],
  paused: ['running', 'stopped', 'draft', 'archived', 'failed'],
  stopped: ['draft', 'scheduled', 'archived'],
  completed: ['archived'],
  archived: ['draft'],
  failed: ['draft', 'archived'],
}

export type CampaignTransitionResult =
  | { valid: true; from: CampaignStatus; to: CampaignStatus }
  | { valid: false; from: CampaignStatus; to: CampaignStatus; reason: string }

export function canTransition(from: CampaignStatus, to: CampaignStatus): CampaignTransitionResult {
  if (from === to) {
    return { valid: true, from, to }
  }
  const allowed = VALID_TRANSITIONS[from]
  if (!allowed) {
    return { valid: false, from, to, reason: `Unknown source status: ${from}` }
  }
  if (allowed.includes(to)) {
    return { valid: true, from, to }
  }
  return {
    valid: false,
    from,
    to,
    reason: `Cannot transition from "${from}" to "${to}". Allowed: ${allowed.join(', ')}`,
  }
}

export function getTargetStatusForAction(action: CampaignAuditAction, _currentStatus: CampaignStatus): CampaignStatus | null {
  switch (action) {
    case 'created':
      return 'draft'
    case 'archived':
      return 'archived'
    case 'paused':
      return 'paused'
    case 'resumed':
      return 'running'
    case 'launched':
      return 'running'
    case 'restored':
      return 'draft'
    case 'duplicated':
      return 'draft'
    case 'template_applied':
      return null
    case 'version_created':
      return null
    case 'rollback':
      return null
    case 'updated':
      return null
    case 'deleted':
      return null
    case 'bulk_action':
      return null
    case 'tags_updated':
      return null
    case 'labels_updated':
      return null
    case 'folder_moved':
      return null
    case 'schedule_created':
      return null
    case 'schedule_updated':
      return null
    default:
      return null
  }
}

export function getStatusLabel(status: CampaignStatus): string {
  const labels: Record<CampaignStatus, string> = {
    draft: 'Draft',
    active: 'Active',
    scheduled: 'Scheduled',
    running: 'Running',
    paused: 'Paused',
    stopped: 'Stopped',
    completed: 'Completed',
    archived: 'Archived',
    failed: 'Failed',
  }
  return labels[status] ?? status
}

export function isActive(status: CampaignStatus): boolean {
  return status === 'active' || status === 'running' || status === 'scheduled'
}

export function canEdit(status: CampaignStatus): boolean {
  return ['draft', 'active', 'scheduled', 'paused'].includes(status)
}

export function canDelete(status: CampaignStatus): boolean {
  return !['running', 'scheduled'].includes(status)
}
