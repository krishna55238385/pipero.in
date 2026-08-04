/**
 * Credential safety helpers (PRD §6.1.11–6.1.12).
 * Never log or return plaintext/encrypted secrets over API boundaries.
 */

const SENSITIVE_KEY =
  /password|passwd|secret|token|authorization|api[_-]?key|credential|refresh|access[_-]?token|encrypted_/i

const SENSITIVE_VALUE =
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*|ya29\.|1\/\/|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/i

export function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[Truncated]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (value.length > 24 && SENSITIVE_VALUE.test(value)) return '[REDACTED]'
    return value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = val == null || val === '' ? val : '[REDACTED]'
      continue
    }
    out[key] = redactSecrets(val, depth + 1)
  }
  return out
}

export function safeLogMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(SENSITIVE_VALUE, '[REDACTED]').slice(0, 500)
  }
  if (typeof err === 'string') {
    return err.replace(SENSITIVE_VALUE, '[REDACTED]').slice(0, 500)
  }
  try {
    return JSON.stringify(redactSecrets(err)).slice(0, 500)
  } catch {
    return 'Unknown error'
  }
}

/** Strip credential columns from an engage_mailboxes row before client/API return. */
export function toPublicEngageMailbox(
  row: Record<string, unknown> | null | undefined
): (Record<string, unknown> & { hasCredentials: boolean; tokensEncrypted: boolean }) | null {
  if (!row) return null
  const {
    access_token: _a,
    refresh_token: _r,
    encrypted_access_token: _ea,
    encrypted_refresh_token: _er,
    ...rest
  } = row
  return {
    ...rest,
    hasCredentials: Boolean(_ea || _a || _er || _r),
    tokensEncrypted: Boolean(_ea || _er),
  }
}

type ConfigLike = {
  encryptedRefreshToken?: string | null
  encryptedAccessToken?: string | null
  encryptedPasswordReference?: string | null
  [key: string]: unknown
}

/** Public mailbox DTO: never includes encrypted token/password material. */
export function toPublicMailboxWithConfigs<T extends {
  oauthConfig?: ConfigLike | null
  smtpConfig?: ConfigLike | null
  imapConfig?: ConfigLike | null
}>(mailbox: T): T {
  const strip = (cfg: ConfigLike | null | undefined) => {
    if (!cfg) return null
    const {
      encryptedRefreshToken: _rt,
      encryptedAccessToken: _at,
      encryptedPasswordReference: _pw,
      ...safe
    } = cfg
    return {
      ...safe,
      hasRefreshToken: Boolean(_rt),
      hasAccessToken: Boolean(_at),
      hasPassword: Boolean(_pw),
    }
  }

  return {
    ...mailbox,
    oauthConfig: strip(mailbox.oauthConfig ?? null) as T['oauthConfig'],
    smtpConfig: strip(mailbox.smtpConfig ?? null) as T['smtpConfig'],
    imapConfig: strip(mailbox.imapConfig ?? null) as T['imapConfig'],
  }
}
