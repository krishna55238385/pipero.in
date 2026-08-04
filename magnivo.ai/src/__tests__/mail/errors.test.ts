import { describe, it, expect } from 'vitest'
import { classifyError, mailErrorToTestResult } from '@/services/mail/errors'

describe('classifyError', () => {
  it('classifies authentication errors', () => {
    const err = classifyError(new Error('Invalid credentials'))
    expect(err.category).toBe('authentication')
    expect(err.message).toContain('Invalid credentials')
  })

  it('classifies 401 as authentication', () => {
    const err = classifyError(new Error('Request failed with 401'))
    expect(err.category).toBe('authentication')
  })

  it('classifies 403 as authentication', () => {
    const err = classifyError(new Error('403 Forbidden'))
    expect(err.category).toBe('authentication')
  })

  it('classifies connection refused as network', () => {
    const err = classifyError(new Error('connect ECONNREFUSED 127.0.0.1:587'))
    expect(err.category).toBe('network')
  })

  it('classifies ENOTFOUND as network', () => {
    const err = classifyError(new Error('getaddrinfo ENOTFOUND smtp.example.com'))
    expect(err.category).toBe('network')
  })

  it('classifies SSL errors', () => {
    const err = classifyError(new Error('SSL certificate problem'))
    expect(err.category).toBe('ssl')
  })

  it('classifies TLS errors', () => {
    const err = classifyError(new Error('TLS handshake failure'))
    expect(err.category).toBe('ssl')
  })

  it('classifies timeout errors', () => {
    const err = classifyError(new Error('Connection timed out'))
    expect(err.category).toBe('timeout')
  })

  it('classifies ETIMEDOUT', () => {
    const err = classifyError(new Error('connect ETIMEDOUT'))
    expect(err.category).toBe('timeout')
  })

  it('classifies rate limit errors', () => {
    const err = classifyError(new Error('429 Too Many Requests'))
    expect(err.category).toBe('rate_limit')
  })

  it('classifies SMTP command errors as configuration', () => {
    const err = classifyError(new Error('502 EHLO command rejected'))
    expect(err.category).toBe('configuration')
  })

  it('classifies unknown errors', () => {
    const err = classifyError(new Error('something weird happened'))
    expect(err.category).toBe('unknown')
  })

  it('handles string errors', () => {
    const err = classifyError('plain string error')
    expect(err.category).toBe('unknown')
    expect(err.message).toBe('plain string error')
  })

  it('handles null/undefined errors', () => {
    const err = classifyError(null)
    expect(err.category).toBe('unknown')
  })

  it('includes provider when given', () => {
    const err = classifyError(new Error('timeout'), 'smtp')
    expect(err.provider).toBe('smtp')
  })

  it('includes originalError', () => {
    const err = classifyError(new Error('raw error'))
    expect(err.originalError).toBe('raw error')
  })
})

describe('mailErrorToTestResult', () => {
  it('maps authentication to invalid_credentials', () => {
    const result = mailErrorToTestResult({
      category: 'authentication',
      message: 'Auth failed',
    })
    expect(result.status).toBe('failure')
    expect(result.errorType).toBe('invalid_credentials')
    expect(result.message).toBe('Auth failed')
  })

  it('maps network to server_unreachable', () => {
    const result = mailErrorToTestResult({
      category: 'network',
      message: 'Cannot reach server',
    })
    expect(result.errorType).toBe('server_unreachable')
  })

  it('maps ssl to ssl_error', () => {
    const result = mailErrorToTestResult({
      category: 'ssl',
      message: 'Cert error',
    })
    expect(result.errorType).toBe('ssl_error')
  })

  it('maps timeout to timeout', () => {
    const result = mailErrorToTestResult({
      category: 'timeout',
      message: 'Timed out',
    })
    expect(result.errorType).toBe('timeout')
  })

  it('maps unknown to unknown', () => {
    const result = mailErrorToTestResult({
      category: 'unknown',
      message: 'Weird',
    })
    expect(result.errorType).toBe('unknown')
  })
})
