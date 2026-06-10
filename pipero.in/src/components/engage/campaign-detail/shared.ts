import type { EngageCampaign, InterestStatus } from '@/types/engage'

// Friendly labels for the per-lead interest dropdown (Instantly-style).
export const INTEREST_LABELS: Record<InterestStatus, string> = {
  lead: 'Lead',
  interested: 'Interested',
  meeting_booked: 'Meeting booked',
  meeting_completed: 'Meeting completed',
  won: 'Won',
  no_show: 'No show',
  out_of_office: 'Out of office',
  wrong_person: 'Wrong person',
  not_interested: 'Not interested',
}

// Campaign-level status badge classes (mirrors CampaignBuilder).
export const STATUS_BADGE: Record<EngageCampaign['status'], string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  running: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
}

// Per-recipient delivery status badge classes.
export const DELIVERY_BADGE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  replied: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  stopped: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  skipped: 'bg-muted text-muted-foreground',
}

export function deliveryLabel(status: string): string {
  return status.replace(/_/g, ' ')
}

// Plain-English explanations for worker skip_reason codes (mirrors CampaignBuilder).
export function skipReasonLabel(reason: string): string {
  if (reason.startsWith('bounce_status:')) return `bad email address (${reason.split(':')[1]})`
  switch (reason) {
    case 'missing_or_invalid_email':
      return 'no valid email address'
    case 'unsubscribed':
      return 'recipient unsubscribed'
    case 'missing_name_and_company':
      return 'missing name and company'
    case 'duplicate_email_in_audience':
      return 'duplicate in audience'
    default:
      return reason
  }
}
