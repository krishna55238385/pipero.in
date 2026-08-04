import { describe, expect, it } from 'vitest'

/** Mirrors revoke detection in handleOAuthSendFailure / oauth probe. */
function isOAuthRevokeError(errorMessage: string): boolean {
  return /revoked|invalid_grant|unauthorized|401|403|expired.*token|token.*expired/i.test(
    errorMessage
  )
}

describe('oauth revoke detection', () => {
  it('detects common Google/Microsoft revoke signals', () => {
    expect(isOAuthRevokeError('invalid_grant')).toBe(true)
    expect(isOAuthRevokeError('Token has been revoked')).toBe(true)
    expect(isOAuthRevokeError('HTTP 401 Unauthorized')).toBe(true)
    expect(isOAuthRevokeError('gmail_403:accessNotConfigured')).toBe(true)
    expect(isOAuthRevokeError('access token expired')).toBe(true)
  })

  it('ignores unrelated SMTP failures', () => {
    expect(isOAuthRevokeError('Connection timed out')).toBe(false)
    expect(isOAuthRevokeError('550 mailbox unavailable')).toBe(false)
  })
})
