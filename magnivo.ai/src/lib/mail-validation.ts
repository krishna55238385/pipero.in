import type {
  ValidationResponse,
  MailboxProvider,
  OAuthProvider,
  SMTPEncryption,
} from '@/types/mail'

const PROVIDER_DAILY_CAPS: Record<string, number> = {
  gmail: 500,
  outlook: 300,
  zoho: 500,
  custom: 10000,
}

export const PROVIDER_MAX_DAILY_LIMITS = PROVIDER_DAILY_CAPS as Record<MailboxProvider, number>

export function getProviderDailyCap(provider: string): number {
  return PROVIDER_DAILY_CAPS[provider] ?? 500
}

function clampDailyLimit(provider: unknown, dailyLimit: number): { ok: boolean; max: number; error?: string } {
  const max = getProviderDailyCap(String(provider || 'custom'))
  if (dailyLimit > max) {
    return { ok: false, max, error: `Daily limit cannot exceed ${max} for provider "${provider}"` }
  }
  return { ok: true, max }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const VALID_MAILBOX_PROVIDERS: MailboxProvider[] = ['gmail', 'outlook', 'zoho', 'custom']
const VALID_OAUTH_PROVIDERS: OAuthProvider[] = ['gmail', 'outlook', 'zoho']
const VALID_SMTP_ENCRYPTIONS: SMTPEncryption[] = ['none', 'ssl', 'starttls']
const VALID_TIMEZONE_PREFIXES = [
  'Africa/', 'America/', 'Antarctica/', 'Arctic/', 'Asia/',
  'Atlantic/', 'Australia/', 'Europe/', 'Indian/', 'Pacific/', 'UTC',
]

const VALID_WARMUP_CONFIG_STATUSES = ['draft', 'pending', 'running', 'paused', 'completed', 'graduated', 'disabled', 'failed', 'cancelled']
const VALID_WARMUP_STAGES = ['initial', 'learning', 'growing', 'established', 'graduated']
const VALID_WARMUP_HEALTHS = ['excellent', 'healthy', 'warning', 'critical']

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value)
}

function isValidTimezone(tz: string): boolean {
  if (!isNonEmptyString(tz)) return false
  if (tz === 'UTC') return true
  return VALID_TIMEZONE_PREFIXES.some((prefix) => tz.startsWith(prefix))
}

function isNumberBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

// ============================================================
// CreateMailboxRequest Validation
// ============================================================

export function validateCreateMailboxRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (!isNonEmptyString(req.email)) {
    errors.push('Email is required')
  } else if (!isValidEmail(req.email)) {
    errors.push('Email format is invalid')
  }

  if (!isNonEmptyString(req.provider)) {
    errors.push('Provider is required')
  } else if (!VALID_MAILBOX_PROVIDERS.includes(req.provider as MailboxProvider)) {
    errors.push(`Provider must be one of: ${VALID_MAILBOX_PROVIDERS.join(', ')}`)
  }

  if (!isNonEmptyString(req.authType)) {
    errors.push('Auth type is required')
  } else if (!['oauth', 'smtp', 'imap'].includes(req.authType as string)) {
    errors.push('Auth type must be oauth, smtp, or imap')
  }

  if (req.timezone !== undefined && req.timezone !== null && isNonEmptyString(req.timezone)) {
    if (!isValidTimezone(req.timezone)) {
      errors.push('Timezone is invalid')
    }
  }

  if (req.dailyLimit !== undefined && req.dailyLimit !== null) {
    if (!isNumberBetween(req.dailyLimit, 1, 10000)) {
      errors.push('Daily limit must be between 1 and 10000')
    } else {
      const cap = clampDailyLimit(req.provider, req.dailyLimit as number)
      if (!cap.ok && cap.error) errors.push(cap.error)
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// UpdateMailboxRequest Validation
// ============================================================

export function validateUpdateMailboxRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (req.timezone !== undefined && req.timezone !== null && isNonEmptyString(req.timezone)) {
    if (!isValidTimezone(req.timezone)) {
      errors.push('Timezone is invalid')
    }
  }

  if (req.dailyLimit !== undefined && req.dailyLimit !== null) {
    if (!isNumberBetween(req.dailyLimit, 1, 10000)) {
      errors.push('Daily limit must be between 1 and 10000')
    } else if (req.provider) {
      const cap = clampDailyLimit(req.provider, req.dailyLimit as number)
      if (!cap.ok && cap.error) errors.push(cap.error)
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// CreateMailboxPoolRequest Validation
// ============================================================

export function validateCreateMailboxPoolRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (!isNonEmptyString(req.name)) {
    errors.push('Pool name is required')
  } else if (req.name.trim().length > 100) {
    errors.push('Pool name must be 100 characters or fewer')
  }

  if (req.dailyPoolLimit !== undefined && req.dailyPoolLimit !== null) {
    if (!isNumberBetween(req.dailyPoolLimit, 1, 50000)) {
      errors.push('Daily pool limit must be between 1 and 50000')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// UpdateMailboxPoolRequest Validation
// ============================================================

export function validateUpdateMailboxPoolRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (req.name !== undefined && req.name !== null) {
    if (!isNonEmptyString(req.name)) {
      errors.push('Pool name cannot be empty')
    } else if ((req.name as string).trim().length > 100) {
      errors.push('Pool name must be 100 characters or fewer')
    }
  }

  if (req.status !== undefined && req.status !== null) {
    if (!['active', 'inactive'].includes(req.status as string)) {
      errors.push('Status must be active or inactive')
    }
  }

  if (req.dailyPoolLimit !== undefined && req.dailyPoolLimit !== null) {
    if (!isNumberBetween(req.dailyPoolLimit, 1, 50000)) {
      errors.push('Daily pool limit must be between 1 and 50000')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// SMTP Config Validation
// ============================================================

export function validateSMTPConfig(config: unknown): ValidationResponse {
  const errors: string[] = []
  const c = config as Record<string, unknown>

  if (!c || typeof c !== 'object') {
    return { valid: false, errors: ['SMTP configuration is required'] }
  }

  if (!isNonEmptyString(c.smtpHost)) {
    errors.push('SMTP host is required')
  }

  if (!isNumberBetween(c.smtpPort, 1, 65535)) {
    errors.push('SMTP port must be between 1 and 65535')
  }

  if (!isNonEmptyString(c.username)) {
    errors.push('SMTP username is required')
  }

  if (!isNonEmptyString(c.encryptedPasswordReference)) {
    errors.push('SMTP password reference is required')
  }

  if (!isNonEmptyString(c.encryption) || !VALID_SMTP_ENCRYPTIONS.includes(c.encryption as SMTPEncryption)) {
    errors.push(`Encryption must be one of: ${VALID_SMTP_ENCRYPTIONS.join(', ')}`)
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// OAuth Config Validation
// ============================================================

export function validateOAuthProvider(provider: unknown): ValidationResponse {
  const errors: string[] = []

  if (!isNonEmptyString(provider)) {
    errors.push('OAuth provider is required')
  } else if (!VALID_OAUTH_PROVIDERS.includes(provider as OAuthProvider)) {
    errors.push(`OAuth provider must be one of: ${VALID_OAUTH_PROVIDERS.join(', ')}`)
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// Duplicate Detection
// ============================================================

export function buildDuplicateMailboxCheck(
  email: string,
  organizationId: string,
  excludeId?: string
): { whereClause: string; values: (string | number)[] } {
  const conditions = ['LOWER(email) = LOWER($1)', 'organization_id = $2']
  const values: (string | number)[] = [email, organizationId]

  if (excludeId) {
    conditions.push('id != $3')
    values.push(excludeId)
  }

  return {
    whereClause: conditions.join(' AND '),
    values,
  }
}

// ============================================================
// Pool Ownership Validation
// ============================================================

export function validatePoolOwnership(
  poolOrganizationId: string,
  requestOrganizationId: string
): ValidationResponse {
  if (poolOrganizationId !== requestOrganizationId) {
    return { valid: false, errors: ['Pool does not belong to this organization'] }
  }
  return { valid: true, errors: [] }
}

// ============================================================
// IMAP Config Validation
// ============================================================

export function validateIMAPConfig(config: unknown): ValidationResponse {
  const errors: string[] = []
  const c = config as Record<string, unknown>

  if (!c || typeof c !== 'object') {
    return { valid: false, errors: ['IMAP configuration is required'] }
  }

  if (!isNonEmptyString(c.host)) {
    errors.push('IMAP host is required')
  }

  if (!isNumberBetween(c.port, 1, 65535)) {
    errors.push('IMAP port must be between 1 and 65535')
  }

  if (c.authentication !== undefined && c.authentication !== null) {
    if (!['password', 'oauth2'].includes(c.authentication as string)) {
      errors.push('IMAP authentication must be password or oauth2')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// OAuth Config Request Validation
// ============================================================

export function validateCreateOAuthConfigRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (!isNonEmptyString(req.mailboxId)) {
    errors.push('Mailbox ID is required')
  }

  if (!isNonEmptyString(req.provider)) {
    errors.push('OAuth provider is required')
  } else if (!VALID_OAUTH_PROVIDERS.includes(req.provider as OAuthProvider)) {
    errors.push(`OAuth provider must be one of: ${VALID_OAUTH_PROVIDERS.join(', ')}`)
  }

  if (!isNonEmptyString(req.providerAccountId)) {
    errors.push('Provider account ID is required')
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// SMTP Config Request Validation
// ============================================================

export function validateCreateSMTPConfigRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (!isNonEmptyString(req.mailboxId)) {
    errors.push('Mailbox ID is required')
  }

  if (!isNonEmptyString(req.smtpHost)) {
    errors.push('SMTP host is required')
  }

  if (!isNumberBetween(req.smtpPort, 1, 65535)) {
    errors.push('SMTP port must be between 1 and 65535')
  }

  if (!isNonEmptyString(req.username)) {
    errors.push('SMTP username is required')
  }

  if (!isNonEmptyString(req.encryptedPasswordReference)) {
    errors.push('SMTP password reference is required')
  }

  if (!isNonEmptyString(req.encryption) || !VALID_SMTP_ENCRYPTIONS.includes(req.encryption as SMTPEncryption)) {
    errors.push(`Encryption must be one of: ${VALID_SMTP_ENCRYPTIONS.join(', ')}`)
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// IMAP Config Request Validation
// ============================================================

export function validateCreateIMAPConfigRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (!isNonEmptyString(req.mailboxId)) {
    errors.push('Mailbox ID is required')
  }

  if (!isNonEmptyString(req.host)) {
    errors.push('IMAP host is required')
  }

  if (!isNumberBetween(req.port, 1, 65535)) {
    errors.push('IMAP port must be between 1 and 65535')
  }

  if (req.authentication !== undefined && req.authentication !== null) {
    if (!['password', 'oauth2'].includes(req.authentication as string)) {
      errors.push('IMAP authentication must be password or oauth2')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ============================================================
// Warmup Config Validation
// ============================================================

export function validateCreateWarmupConfigRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (!isNonEmptyString(req.mailboxId)) {
    errors.push('Mailbox ID is required')
  }

  if (req.timezone !== undefined && req.timezone !== null && isNonEmptyString(req.timezone)) {
    if (!isValidTimezone(req.timezone)) {
      errors.push('Timezone is invalid')
    }
  }

  if (req.maxDailySends !== undefined && req.maxDailySends !== null) {
    if (!isNumberBetween(req.maxDailySends, 1, 500)) {
      errors.push('Max daily sends must be between 1 and 500')
    }
  }

  if (req.dailyIncrease !== undefined && req.dailyIncrease !== null) {
    if (!isNumberBetween(req.dailyIncrease, 1, 100)) {
      errors.push('Daily increase must be between 1 and 100')
    }
  }

  if (req.initialSends !== undefined && req.initialSends !== null) {
    if (!isNumberBetween(req.initialSends, 1, 100)) {
      errors.push('Initial sends must be between 1 and 100')
    }
  }

  if (req.totalDays !== undefined && req.totalDays !== null) {
    if (!isNumberBetween(req.totalDays, 1, 365)) {
      errors.push('Total days must be between 1 and 365')
    }
  }

  if (req.businessHoursStart !== undefined && req.businessHoursStart !== null) {
    if (!isNumberBetween(req.businessHoursStart, 0, 23)) {
      errors.push('Business hours start must be between 0 and 23')
    }
  }

  if (req.businessHoursEnd !== undefined && req.businessHoursEnd !== null) {
    if (!isNumberBetween(req.businessHoursEnd, 0, 23)) {
      errors.push('Business hours end must be between 0 and 23')
    }
  }

  if (req.minDelayMs !== undefined && req.minDelayMs !== null) {
    if (!isNumberBetween(req.minDelayMs, 0, 3600000)) {
      errors.push('Min delay must be between 0 and 3600000')
    }
  }

  if (req.maxDelayMs !== undefined && req.maxDelayMs !== null) {
    if (!isNumberBetween(req.maxDelayMs, 0, 3600000)) {
      errors.push('Max delay must be between 0 and 3600000')
    }
  }

  if (req.randomizationFactor !== undefined && req.randomizationFactor !== null) {
    if (!isNumberBetween(req.randomizationFactor, 0, 1)) {
      errors.push('Randomization factor must be between 0 and 1')
    }
  }

  if (req.targetHealthScore !== undefined && req.targetHealthScore !== null) {
    if (!isNumberBetween(req.targetHealthScore, 1, 100)) {
      errors.push('Target health score must be between 1 and 100')
    }
  }

  if (req.graduationThreshold !== undefined && req.graduationThreshold !== null) {
    if (!isNumberBetween(req.graduationThreshold, 1, 100)) {
      errors.push('Graduation threshold must be between 1 and 100')
    }
  }

  if (req.pauseThreshold !== undefined && req.pauseThreshold !== null) {
    if (!isNumberBetween(req.pauseThreshold, 1, 100)) {
      errors.push('Pause threshold must be between 1 and 100')
    }
  }

  if (req.resumeThreshold !== undefined && req.resumeThreshold !== null) {
    if (!isNumberBetween(req.resumeThreshold, 1, 100)) {
      errors.push('Resume threshold must be between 1 and 100')
    }
  }

  if (req.initialSends !== undefined && req.maxDailySends !== undefined) {
    if (typeof req.initialSends === 'number' && typeof req.maxDailySends === 'number') {
      if (req.initialSends >= req.maxDailySends) {
        errors.push('Initial sends must be less than max daily sends')
      }
    }
  }

  if (req.graduationThreshold !== undefined && req.pauseThreshold !== undefined) {
    if (typeof req.graduationThreshold === 'number' && typeof req.pauseThreshold === 'number') {
      if (req.graduationThreshold <= req.pauseThreshold) {
        errors.push('Graduation threshold must exceed pause threshold')
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

export function validateUpdateWarmupConfigRequest(input: unknown): ValidationResponse {
  const errors: string[] = []
  const req = input as Record<string, unknown>

  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request body is required'] }
  }

  if (req.timezone !== undefined && req.timezone !== null && isNonEmptyString(req.timezone)) {
    if (!isValidTimezone(req.timezone)) {
      errors.push('Timezone is invalid')
    }
  }

  if (req.maxDailySends !== undefined && req.maxDailySends !== null) {
    if (!isNumberBetween(req.maxDailySends, 1, 500)) {
      errors.push('Max daily sends must be between 1 and 500')
    }
  }

  if (req.dailyIncrease !== undefined && req.dailyIncrease !== null) {
    if (!isNumberBetween(req.dailyIncrease, 1, 100)) {
      errors.push('Daily increase must be between 1 and 100')
    }
  }

  if (req.initialSends !== undefined && req.initialSends !== null) {
    if (!isNumberBetween(req.initialSends, 1, 100)) {
      errors.push('Initial sends must be between 1 and 100')
    }
  }

  if (req.totalDays !== undefined && req.totalDays !== null) {
    if (!isNumberBetween(req.totalDays, 1, 365)) {
      errors.push('Total days must be between 1 and 365')
    }
  }

  if (req.minDelayMs !== undefined && req.minDelayMs !== null) {
    if (!isNumberBetween(req.minDelayMs, 0, 3600000)) {
      errors.push('Min delay must be between 0 and 3600000')
    }
  }

  if (req.maxDelayMs !== undefined && req.maxDelayMs !== null) {
    if (!isNumberBetween(req.maxDelayMs, 0, 3600000)) {
      errors.push('Max delay must be between 0 and 3600000')
    }
  }

  if (req.randomizationFactor !== undefined && req.randomizationFactor !== null) {
    if (!isNumberBetween(req.randomizationFactor, 0, 1)) {
      errors.push('Randomization factor must be between 0 and 1')
    }
  }

  if (req.targetHealthScore !== undefined && req.targetHealthScore !== null) {
    if (!isNumberBetween(req.targetHealthScore, 1, 100)) {
      errors.push('Target health score must be between 1 and 100')
    }
  }

  if (req.graduationThreshold !== undefined && req.graduationThreshold !== null) {
    if (!isNumberBetween(req.graduationThreshold, 1, 100)) {
      errors.push('Graduation threshold must be between 1 and 100')
    }
  }

  if (req.pauseThreshold !== undefined && req.pauseThreshold !== null) {
    if (!isNumberBetween(req.pauseThreshold, 1, 100)) {
      errors.push('Pause threshold must be between 1 and 100')
    }
  }

  if (req.resumeThreshold !== undefined && req.resumeThreshold !== null) {
    if (!isNumberBetween(req.resumeThreshold, 1, 100)) {
      errors.push('Resume threshold must be between 1 and 100')
    }
  }

  return { valid: errors.length === 0, errors }
}

export function validateWarmupConfigStatus(status: unknown): ValidationResponse {
  const errors: string[] = []
  if (!isNonEmptyString(status)) {
    errors.push('Status is required')
  } else if (!VALID_WARMUP_CONFIG_STATUSES.includes(status as string)) {
    errors.push(`Status must be one of: ${VALID_WARMUP_CONFIG_STATUSES.join(', ')}`)
  }
  return { valid: errors.length === 0, errors }
}

export function validateWarmupStage(stage: unknown): ValidationResponse {
  const errors: string[] = []
  if (!isNonEmptyString(stage)) {
    errors.push('Stage is required')
  } else if (!VALID_WARMUP_STAGES.includes(stage as string)) {
    errors.push(`Stage must be one of: ${VALID_WARMUP_STAGES.join(', ')}`)
  }
  return { valid: errors.length === 0, errors }
}

export function validateWarmupHealth(health: unknown): ValidationResponse {
  const errors: string[] = []
  if (!isNonEmptyString(health)) {
    errors.push('Health is required')
  } else if (!VALID_WARMUP_HEALTHS.includes(health as string)) {
    errors.push(`Health must be one of: ${VALID_WARMUP_HEALTHS.join(', ')}`)
  }
  return { valid: errors.length === 0, errors }
}
