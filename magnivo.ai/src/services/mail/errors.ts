import type { WizardTestResult } from '@/types/mail'

export type MailErrorCategory =
  | 'authentication'
  | 'network'
  | 'ssl'
  | 'timeout'
  | 'configuration'
  | 'rate_limit'
  | 'unknown'

export type MailError = {
  category: MailErrorCategory
  message: string
  provider?: string
  originalError?: string
}

export function classifyError(err: unknown, provider?: string): MailError {
  const raw = err instanceof Error ? err.message : String(err)
  const lower = raw.toLowerCase()

  if (lower.includes('invalid') && (lower.includes('credential') || lower.includes('password') || lower.includes('auth') || lower.includes('login'))) {
    return { category: 'authentication', message: 'Invalid credentials. Please check your username and password.', provider, originalError: raw }
  }
  if (lower.includes('401') || lower.includes('403') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return { category: 'authentication', message: 'Authentication failed. Your credentials may have expired or been revoked.', provider, originalError: raw }
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return { category: 'timeout', message: 'Connection timed out. The server may be unreachable.', provider, originalError: raw }
  }
  if (lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('getaddrinfo') || lower.includes('could not reach')) {
    return { category: 'network', message: 'Could not reach the server. Check the hostname and port.', provider, originalError: raw }
  }
  if (lower.includes('ssl') || lower.includes('tls') || lower.includes('certificate') || lower.includes('cert')) {
    return { category: 'ssl', message: 'SSL/TLS certificate error. Try a different encryption setting.', provider, originalError: raw }
  }
  if (lower.includes('rate') || lower.includes('too many') || lower.includes('429')) {
    return { category: 'rate_limit', message: 'Rate limited by the server. Try again later.', provider, originalError: raw }
  }
  if (lower.includes('ehlo') || lower.includes('helo') || lower.includes('smtp') || lower.includes('command')) {
    return { category: 'configuration', message: 'SMTP server rejected the command. Check your server settings.', provider, originalError: raw }
  }
  return { category: 'unknown', message: raw || 'An unexpected error occurred.', provider, originalError: raw }
}

export function mailErrorToTestResult(error: MailError): WizardTestResult {
  const errorTypeMap: Record<MailErrorCategory, WizardTestResult['errorType']> = {
    authentication: 'invalid_credentials',
    network: 'server_unreachable',
    ssl: 'ssl_error',
    timeout: 'timeout',
    configuration: 'server_unreachable',
    rate_limit: 'server_unreachable',
    unknown: 'unknown',
  }
  return {
    status: 'failure',
    errorType: errorTypeMap[error.category],
    message: error.message,
  }
}
