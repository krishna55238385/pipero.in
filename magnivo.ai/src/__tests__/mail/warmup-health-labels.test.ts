import { describe, expect, it } from 'vitest'
import { toPrdWarmupHealthLabel } from '@/services/mail/warmup-analytics-service'

describe('toPrdWarmupHealthLabel', () => {
  it('maps excellent/graduated to Warm', () => {
    expect(toPrdWarmupHealthLabel('excellent')).toBe('Warm')
    expect(toPrdWarmupHealthLabel('healthy', 'graduated')).toBe('Warm')
  })

  it('maps critical/initial to Cold', () => {
    expect(toPrdWarmupHealthLabel('critical')).toBe('Cold')
    expect(toPrdWarmupHealthLabel('healthy', 'initial')).toBe('Cold')
  })

  it('maps mid states to Warming', () => {
    expect(toPrdWarmupHealthLabel('healthy', 'growing')).toBe('Warming')
    expect(toPrdWarmupHealthLabel('warning')).toBe('Warming')
  })
})
