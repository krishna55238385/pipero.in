import { describe, expect, it } from 'vitest'
import {
  shouldPauseForBounceRate,
  shouldPauseForComplaintRate,
} from '@/services/mail/auto-pause-service'
import {
  buildAnalyticsRiskAndRecommendations,
} from '@/services/mail/analytics-service'
import { nextRunAfter } from '@/services/mail/scheduled-reports-service'

describe('auto-pause thresholds (PRD §6.7.10 / §6.7.13)', () => {
  it('does not pause below minimum send volume', () => {
    expect(shouldPauseForBounceRate(40, 10)).toBe(false)
    expect(shouldPauseForComplaintRate(40, 5)).toBe(false)
  })

  it('pauses when soft-bounce rate is >= 5%', () => {
    expect(shouldPauseForBounceRate(100, 5)).toBe(true)
    expect(shouldPauseForBounceRate(100, 4)).toBe(false)
  })

  it('pauses when complaint rate is > 0.3%', () => {
    expect(shouldPauseForComplaintRate(1000, 4)).toBe(true)
    expect(shouldPauseForComplaintRate(1000, 3)).toBe(false)
  })
})

describe('analytics risk scoring (PRD §6.7.22–23)', () => {
  it('returns stable recommendations when metrics are healthy', () => {
    const result = buildAnalyticsRiskAndRecommendations({
      bounceRate: 0.01,
      complaintMailboxes: 0,
      openRate: 0.35,
      spamRate: 5,
      suspendedMailboxes: 0,
    })
    expect(result.riskScore).toBeLessThan(40)
    expect(result.recommendations[0]).toMatch(/stable/i)
  })

  it('elevates risk for high bounce and spam rates', () => {
    const result = buildAnalyticsRiskAndRecommendations({
      bounceRate: 0.08,
      complaintMailboxes: 2,
      openRate: 0.05,
      spamRate: 35,
      suspendedMailboxes: 1,
    })
    expect(result.riskScore).toBeGreaterThan(60)
    expect(result.recommendations.length).toBeGreaterThan(1)
  })
})

describe('scheduled report cadence', () => {
  it('advances next run by cadence', () => {
    const from = new Date('2026-07-01T00:00:00.000Z')
    expect(nextRunAfter(from, 'daily').toISOString()).toBe('2026-07-02T00:00:00.000Z')
    expect(nextRunAfter(from, 'weekly').toISOString()).toBe('2026-07-08T00:00:00.000Z')
    expect(nextRunAfter(from, 'monthly').toISOString()).toBe('2026-08-01T00:00:00.000Z')
  })
})
