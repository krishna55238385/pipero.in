import type { MailboxStatus, MailboxAuditAction } from '@/types/mail'

// ============================================================
// Mailbox State Machine
// Defines valid transitions between mailbox statuses.
// Every status change must go through canTransition() to be
// validated, preventing illegal state changes.
// ============================================================

const VALID_TRANSITIONS: Record<MailboxStatus, MailboxStatus[]> = {
  // Initial state after creation (SMTP/IMAP) or OAuth redirect pending
  pending: ['connected', 'testing', 'pending_dns', 'error', 'deleted'],

  // Actively testing SMTP/IMAP/OAuth after reconnect or new setup
  testing: ['connected', 'pending_dns', 'error', 'reconnect_required', 'deleted'],

  // Connected but DNS not yet verified (PRD §6.1 / §6.2)
  pending_dns: [
    'pending_warmup',
    'at_risk',
    'connected',
    'warming',
    'testing',
    'error',
    'reconnect_required',
    'disabled',
    'archived',
    'deleted',
  ],

  // DNS ok (or overridden) — waiting for warmup start
  pending_warmup: [
    'warming',
    'connected',
    'at_risk',
    'pending_dns',
    'error',
    'disabled',
    'archived',
    'deleted',
  ],

  // Soft DNS override — can proceed with risk flag
  at_risk: [
    'pending_warmup',
    'warming',
    'connected',
    'pending_dns',
    'error',
    'disabled',
    'archived',
    'deleted',
  ],

  // Fully operational — can send and receive mail
  connected: [
    'disconnected',
    'disabled',
    'archived',
    'warming',
    'pending_dns',
    'pending_warmup',
    'at_risk',
    'error',
    'reconnect_required',
    'oauth_expired',
    'smtp_failed',
    'imap_failed',
    'verification_failed',
    'suspended',
    'deleted',
  ],

  // Previously connected but currently offline (e.g. user disabled)
  disconnected: [
    'connected',
    'disabled',
    'archived',
    'error',
    'reconnect_required',
    'oauth_expired',
    'pending_dns',
    'deleted',
  ],

  // Actively warming up (sending volume ramp)
  warming: [
    'connected',
    'pending_warmup',
    'error',
    'disabled',
    'archived',
    'reconnect_required',
    'suspended',
    'deleted',
  ],

  // Unusable due to an error (temporary)
  error: [
    'connected',
    'reconnect_required',
    'testing',
    'pending_dns',
    'disabled',
    'archived',
    'deleted',
  ],

  // Temporarily suspended (e.g. by pool limit, manual suspend)
  suspended: [
    'connected',
    'disabled',
    'archived',
    'reconnect_required',
    'deleted',
  ],

  // Manually disabled by user — cannot send mail
  disabled: [
    'connected',
    'disconnected',
    'archived',
    'deleted',
  ],

  // Archived — hidden from default views, cannot send mail
  archived: [
    'connected',
    'disconnected',
    'disabled',
    'deleted',
  ],

  // Soft-deleted — configs/logs preserved, hidden everywhere
  deleted: [],

  // OAuth token expired, needs re-authorization
  reconnect_required: [
    'connected',
    'testing',
    'pending_dns',
    'error',
    'disabled',
    'deleted',
  ],

  // OAuth token specifically expired
  oauth_expired: [
    'connected',
    'reconnect_required',
    'testing',
    'disabled',
    'deleted',
  ],

  // SMTP credentials failed authentication
  smtp_failed: [
    'connected',
    'reconnect_required',
    'testing',
    'error',
    'disabled',
    'deleted',
  ],

  // IMAP connection failed
  imap_failed: [
    'connected',
    'reconnect_required',
    'testing',
    'error',
    'disabled',
    'deleted',
  ],

  // Connection verification failed
  verification_failed: [
    'connected',
    'reconnect_required',
    'testing',
    'error',
    'disabled',
    'deleted',
  ],
}

// Special transition: 'restored' isn't a MailboxStatus, it's an action that
// brings 'archived' → 'connected'. We model this as the archived → connected
// transition in the valid map above.

export type TransitionResult =
  | { valid: true; from: MailboxStatus; to: MailboxStatus }
  | { valid: false; from: MailboxStatus; to: MailboxStatus; reason: string }

/**
 * Check if a state transition is valid.
 */
export function canTransition(from: MailboxStatus, to: MailboxStatus): TransitionResult {
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

/**
 * Given an action name, determine what the target status should be.
 */
export function getTargetStatusForAction(action: MailboxAuditAction, currentStatus: MailboxStatus): MailboxStatus | null {
  switch (action) {
    case 'enabled':
      return 'connected'
    case 'disabled':
      return 'disabled'
    case 'archived':
      return 'archived'
    case 'restored':
      return 'connected'
    case 'soft_deleted':
      return 'deleted'
    case 'reconnect_attempted':
      return 'reconnect_required'
    case 'verified':
      return currentStatus === 'connected' ? 'connected' : 'testing'
    case 'verification_failed':
      return 'verification_failed'
    default:
      return null
  }
}

/**
 * Map a mailbox status to a user-friendly label.
 */
export function getStatusLabel(status: MailboxStatus): string {
  const labels: Record<MailboxStatus, string> = {
    pending: 'Pending',
    testing: 'Testing',
    connected: 'Connected',
    disconnected: 'Disconnected',
    warming: 'Warming',
    error: 'Error',
    suspended: 'Suspended',
    disabled: 'Disabled',
    archived: 'Archived',
    deleted: 'Deleted',
    reconnect_required: 'Reconnect Required',
    oauth_expired: 'OAuth Expired',
    smtp_failed: 'SMTP Failed',
    imap_failed: 'IMAP Failed',
    verification_failed: 'Verification Failed',
    pending_dns: 'Pending DNS Setup',
    pending_warmup: 'Pending Warmup',
    at_risk: 'At Risk',
  }
  return labels[status] ?? status
}

/**
 * Check if a status is "sendable" — i.e. the mailbox can actively send mail.
 * Live campaign sends require connected (warm/graduated). Warming is warmup-only.
 */
export function isSendable(status: MailboxStatus): boolean {
  return status === 'connected'
}

export function isWarmupEligible(status: MailboxStatus): boolean {
  return status === 'pending_warmup' || status === 'at_risk' || status === 'warming' || status === 'connected'
}

/**
 * Check if a status is "needs attention" — user action required.
 */
export function needsAttention(status: MailboxStatus): boolean {
  return [
    'error',
    'reconnect_required',
    'oauth_expired',
    'smtp_failed',
    'imap_failed',
    'verification_failed',
    'at_risk',
    'pending_dns',
  ].includes(status)
}

/**
 * Check if a status is "hidden" — not shown in default dashboard views.
 */
export function isHidden(status: MailboxStatus): boolean {
  return status === 'archived' || status === 'deleted'
}
