import { vi } from 'vitest'
import {
  validateCanPauseWarmup,
  validateCanResumeWarmup,
  validateCanRestartWarmup,
  validateCanGraduateWarmup,
  validateCanUpdateWarmup,
  validateCanDeleteWarmup,
  validateCanBulkOperation,
} from '@/services/mail/warmup-validation-service'
import {
  calculateStageForDay,
  shouldAdvanceStage,
  calculateDailyTarget,
} from '@/services/mail/warmup-stage-service'
import {
  calculateHealthScore,
  scoreToHealth,
} from '@/services/mail/warmup-health-service'
import {
  calculateDailyTarget as calcDailyTarget,
  isWeekend,
  shouldSendToday,
} from '@/services/mail/warmup-progress-service'
import type {
  WarmupConfigModel,
  WarmupDailyStats,
} from '@/types/mail'

vi.mock('@/repositories/mail/warmup-repository', () => ({
  findConfigById: vi.fn().mockResolvedValue(null),
  findActiveConfigByMailboxId: vi.fn().mockResolvedValue(null),
  findMailboxById: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/repositories/mail/mailbox-repository', () => ({
  findMailboxById: vi.fn().mockResolvedValue(null),
}))

function makeConfig(overrides: Partial<WarmupConfigModel> = {}): WarmupConfigModel {
  return {
    id: 'cfg-1',
    organizationId: 'org-1',
    mailboxId: 'mb-1',
    status: 'running',
    stage: 'initial',
    health: 'healthy',
    startDate: '2026-01-01T00:00:00Z',
    endDate: null,
    pausedAt: null,
    resumedAt: null,
    graduatedAt: null,
    currentDay: 5,
    totalDays: 30,
    initialSends: 5,
    maxDailySends: 50,
    dailyIncrease: 2,
    currentDailyTarget: 13,
    weekendSending: false,
    businessHoursStart: 9,
    businessHoursEnd: 17,
    timezone: 'UTC',
    minDelayMs: 30000,
    maxDelayMs: 120000,
    randomizationFactor: 0.3,
    replySimulation: true,
    readSimulation: true,
    spamRescue: true,
    openSimulation: true,
    clickSimulation: false,
    targetHealthScore: 80,
    graduationThreshold: 75,
    pauseThreshold: 30,
    resumeThreshold: 50,
    pauseReason: null,
    failureReason: null,
    metadata: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeStats(overrides: Partial<WarmupDailyStats> = {}): WarmupDailyStats {
  return {
    id: 'stat-1',
    configId: 'cfg-1',
    organizationId: 'org-1',
    date: '2026-01-05',
    dayNumber: 5,
    targetSends: 13,
    actualSends: 12,
    successfulSends: 11,
    failedSends: 1,
    bouncedSends: 0,
    repliesReceived: 2,
    opensTracked: 8,
    clicksTracked: 3,
    spamReports: 0,
    healthScore: 72,
    reputationScore: 80,
    metadata: {},
    createdAt: '2026-01-05T00:00:00Z',
    ...overrides,
  }
}

describe('warmup-validation-service', () => {
  describe('validateCanPauseWarmup', () => {
    it('allows pausing a running config', () => {
      const result = validateCanPauseWarmup(makeConfig({ status: 'running' }))
      expect(result.valid).toBe(true)
    })

    it('allows pausing a pending config', () => {
      const result = validateCanPauseWarmup(makeConfig({ status: 'pending' }))
      expect(result.valid).toBe(true)
    })

    it('rejects pausing a draft config', () => {
      const result = validateCanPauseWarmup(makeConfig({ status: 'draft' }))
      expect(result.valid).toBe(false)
    })

    it('rejects pausing a paused config', () => {
      const result = validateCanPauseWarmup(makeConfig({ status: 'paused' }))
      expect(result.valid).toBe(false)
    })

    it('rejects pausing a completed config', () => {
      const result = validateCanPauseWarmup(makeConfig({ status: 'completed' }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanResumeWarmup', () => {
    it('allows resuming a paused config', () => {
      const result = validateCanResumeWarmup(makeConfig({ status: 'paused' }))
      expect(result.valid).toBe(true)
    })

    it('rejects resuming a running config', () => {
      const result = validateCanResumeWarmup(makeConfig({ status: 'running' }))
      expect(result.valid).toBe(false)
    })

    it('rejects resuming a draft config', () => {
      const result = validateCanResumeWarmup(makeConfig({ status: 'draft' }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanRestartWarmup', () => {
    it('allows restarting a completed config', () => {
      const result = validateCanRestartWarmup(makeConfig({ status: 'completed' }))
      expect(result.valid).toBe(true)
    })

    it('allows restarting a failed config', () => {
      const result = validateCanRestartWarmup(makeConfig({ status: 'failed' }))
      expect(result.valid).toBe(true)
    })

    it('allows restarting a graduated config', () => {
      const result = validateCanRestartWarmup(makeConfig({ status: 'graduated' }))
      expect(result.valid).toBe(true)
    })

    it('allows restarting a paused config when currentDay >= totalDays', () => {
      const result = validateCanRestartWarmup(makeConfig({ status: 'paused', currentDay: 30, totalDays: 30 }))
      expect(result.valid).toBe(true)
    })

    it('rejects restarting a running config', () => {
      const result = validateCanRestartWarmup(makeConfig({ status: 'running', currentDay: 5 }))
      expect(result.valid).toBe(false)
    })

    it('rejects restarting a paused config before totalDays', () => {
      const result = validateCanRestartWarmup(makeConfig({ status: 'paused', currentDay: 10, totalDays: 30 }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanGraduateWarmup', () => {
    it('allows graduating when ramp duration and health are both met', () => {
      const result = validateCanGraduateWarmup(
        makeConfig({ status: 'running', health: 'healthy', currentDay: 30, totalDays: 30 })
      )
      expect(result.valid).toBe(true)
    })

    it('rejects graduating with excellent health before min ramp duration', () => {
      const result = validateCanGraduateWarmup(
        makeConfig({ status: 'running', health: 'excellent', currentDay: 5, totalDays: 30 })
      )
      expect(result.valid).toBe(false)
    })

    it('allows graduating a paused config when ramp and health are met', () => {
      const result = validateCanGraduateWarmup(
        makeConfig({ status: 'paused', health: 'healthy', currentDay: 30, totalDays: 30 })
      )
      expect(result.valid).toBe(true)
    })

    it('rejects graduating a draft config', () => {
      const result = validateCanGraduateWarmup(makeConfig({ status: 'draft' }))
      expect(result.valid).toBe(false)
    })

    it('rejects graduating before min ramp even with healthy status', () => {
      const result = validateCanGraduateWarmup(
        makeConfig({ status: 'running', health: 'healthy', currentDay: 10, totalDays: 30 })
      )
      expect(result.valid).toBe(false)
    })

    it('allows force graduation for admin override', () => {
      const result = validateCanGraduateWarmup(
        makeConfig({ status: 'running', health: 'warning', currentDay: 1, totalDays: 30 }),
        { force: true }
      )
      expect(result.valid).toBe(true)
    })
  })

  describe('validateCanUpdateWarmup', () => {
    it('allows updating a draft config', () => {
      const result = validateCanUpdateWarmup(makeConfig({ status: 'draft' }))
      expect(result.valid).toBe(true)
    })

    it('allows updating a pending config', () => {
      const result = validateCanUpdateWarmup(makeConfig({ status: 'pending' }))
      expect(result.valid).toBe(true)
    })

    it('rejects updating a running config', () => {
      const result = validateCanUpdateWarmup(makeConfig({ status: 'running' }))
      expect(result.valid).toBe(false)
    })

    it('rejects updating a paused config', () => {
      const result = validateCanUpdateWarmup(makeConfig({ status: 'paused' }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanDeleteWarmup', () => {
    it('allows deleting a draft config', () => {
      const result = validateCanDeleteWarmup(makeConfig({ status: 'draft' }))
      expect(result.valid).toBe(true)
    })

    it('allows deleting a completed config', () => {
      const result = validateCanDeleteWarmup(makeConfig({ status: 'completed' }))
      expect(result.valid).toBe(true)
    })

    it('allows deleting a graduated config', () => {
      const result = validateCanDeleteWarmup(makeConfig({ status: 'graduated' }))
      expect(result.valid).toBe(true)
    })

    it('allows deleting a failed config', () => {
      const result = validateCanDeleteWarmup(makeConfig({ status: 'failed' }))
      expect(result.valid).toBe(true)
    })

    it('allows deleting a disabled config', () => {
      const result = validateCanDeleteWarmup(makeConfig({ status: 'disabled' }))
      expect(result.valid).toBe(true)
    })

    it('rejects deleting a running config', () => {
      const result = validateCanDeleteWarmup(makeConfig({ status: 'running' }))
      expect(result.valid).toBe(false)
    })

    it('rejects deleting a paused config', () => {
      const result = validateCanDeleteWarmup(makeConfig({ status: 'paused' }))
      expect(result.valid).toBe(false)
    })
  })

  describe('validateCanBulkOperation', () => {
    it('validates bulk pause for all running configs', () => {
      const configs = [
        makeConfig({ id: 'c1', status: 'running' }),
        makeConfig({ id: 'c2', status: 'running' }),
      ]
      const result = validateCanBulkOperation(configs, 'pause')
      expect(result.valid).toBe(true)
    })

    it('rejects bulk pause if any config is not pausable', () => {
      const configs = [
        makeConfig({ id: 'c1', status: 'running' }),
        makeConfig({ id: 'c2', status: 'draft' }),
      ]
      const result = validateCanBulkOperation(configs, 'pause')
      expect(result.valid).toBe(false)
    })

    it('validates bulk resume for all paused configs', () => {
      const configs = [
        makeConfig({ id: 'c1', status: 'paused' }),
        makeConfig({ id: 'c2', status: 'paused' }),
      ]
      const result = validateCanBulkOperation(configs, 'resume')
      expect(result.valid).toBe(true)
    })

    it('rejects bulk resume if any config is not paused', () => {
      const configs = [
        makeConfig({ id: 'c1', status: 'paused' }),
        makeConfig({ id: 'c2', status: 'running' }),
      ]
      const result = validateCanBulkOperation(configs, 'resume')
      expect(result.valid).toBe(false)
    })

    it('validates bulk delete for non-active configs', () => {
      const configs = [
        makeConfig({ id: 'c1', status: 'completed' }),
        makeConfig({ id: 'c2', status: 'draft' }),
      ]
      const result = validateCanBulkOperation(configs, 'delete')
      expect(result.valid).toBe(true)
    })

    it('rejects bulk delete if any config is running or paused', () => {
      const configs = [
        makeConfig({ id: 'c1', status: 'completed' }),
        makeConfig({ id: 'c2', status: 'running' }),
      ]
      const result = validateCanBulkOperation(configs, 'delete')
      expect(result.valid).toBe(false)
    })
  })
})

describe('warmup-stage-service (pure functions)', () => {
  describe('calculateStageForDay', () => {
    it('returns initial for days 1-7', () => {
      expect(calculateStageForDay(1, 30)).toBe('initial')
      expect(calculateStageForDay(4, 30)).toBe('initial')
      expect(calculateStageForDay(7, 30)).toBe('initial')
    })

    it('returns learning for days 8-21', () => {
      expect(calculateStageForDay(8, 30)).toBe('learning')
      expect(calculateStageForDay(15, 30)).toBe('learning')
      expect(calculateStageForDay(21, 30)).toBe('learning')
    })

    it('returns growing for days 22-45', () => {
      expect(calculateStageForDay(22, 60)).toBe('growing')
      expect(calculateStageForDay(30, 60)).toBe('growing')
      expect(calculateStageForDay(45, 60)).toBe('growing')
    })

    it('returns established for days after growing', () => {
      expect(calculateStageForDay(46, 90)).toBe('established')
      expect(calculateStageForDay(70, 90)).toBe('established')
    })

    it('returns graduated when day >= totalDays', () => {
      expect(calculateStageForDay(30, 30)).toBe('graduated')
      expect(calculateStageForDay(31, 30)).toBe('graduated')
    })
  })

  describe('shouldAdvanceStage', () => {
    it('returns true when stage should change', () => {
      expect(shouldAdvanceStage(8, 30, 'initial')).toBe(true)
      expect(shouldAdvanceStage(22, 60, 'learning')).toBe(true)
    })

    it('returns false when stage is correct', () => {
      expect(shouldAdvanceStage(5, 30, 'initial')).toBe(false)
      expect(shouldAdvanceStage(15, 30, 'learning')).toBe(false)
    })
  })

  describe('calculateDailyTarget', () => {
    it('returns initialSends on day 1', () => {
      expect(calculateDailyTarget(1, { initialSends: 5, dailyIncrease: 2, maxDailySends: 50 })).toBe(5)
    })

    it('increases linearly', () => {
      expect(calculateDailyTarget(2, { initialSends: 5, dailyIncrease: 2, maxDailySends: 50 })).toBe(7)
      expect(calculateDailyTarget(3, { initialSends: 5, dailyIncrease: 2, maxDailySends: 50 })).toBe(9)
    })

    it('caps at maxDailySends', () => {
      expect(calculateDailyTarget(30, { initialSends: 5, dailyIncrease: 2, maxDailySends: 50 })).toBe(50)
      expect(calculateDailyTarget(100, { initialSends: 5, dailyIncrease: 2, maxDailySends: 50 })).toBe(50)
    })
  })
})

describe('warmup-health-service (pure functions)', () => {
  describe('calculateHealthScore', () => {
    it('returns 50 for empty stats', () => {
      expect(calculateHealthScore([])).toBe(50)
    })

    it('calculates high score for good stats', () => {
      const stats = [makeStats({
        actualSends: 100,
        successfulSends: 98,
        bouncedSends: 0,
        spamReports: 0,
      })]
      const score = calculateHealthScore(stats)
      expect(score).toBeGreaterThan(70)
    })

    it('calculates low score for bad stats', () => {
      const stats = [makeStats({
        actualSends: 100,
        successfulSends: 50,
        bouncedSends: 20,
        spamReports: 10,
      })]
      const score = calculateHealthScore(stats)
      expect(score).toBeLessThan(50)
    })
  })

  describe('scoreToHealth', () => {
    it('returns excellent for score >= 80', () => {
      expect(scoreToHealth(80)).toBe('excellent')
      expect(scoreToHealth(95)).toBe('excellent')
    })

    it('returns healthy for score >= 60', () => {
      expect(scoreToHealth(60)).toBe('healthy')
      expect(scoreToHealth(75)).toBe('healthy')
    })

    it('returns warning for score >= 40', () => {
      expect(scoreToHealth(40)).toBe('warning')
      expect(scoreToHealth(55)).toBe('warning')
    })

    it('returns critical for score < 40', () => {
      expect(scoreToHealth(0)).toBe('critical')
      expect(scoreToHealth(39)).toBe('critical')
    })
  })
})

describe('warmup-progress-service (pure functions)', () => {
  describe('calculateDailyTarget', () => {
    it('calculates correctly', () => {
      expect(calcDailyTarget(1, { initialSends: 5, dailyIncrease: 2, maxDailySends: 50 })).toBe(5)
      expect(calcDailyTarget(10, { initialSends: 5, dailyIncrease: 2, maxDailySends: 50 })).toBe(23)
    })
  })

  describe('isWeekend', () => {
    it('returns true for Saturday', () => {
      expect(isWeekend(new Date('2026-07-25'))).toBe(true) // Saturday
    })

    it('returns true for Sunday', () => {
      expect(isWeekend(new Date('2026-07-26'))).toBe(true) // Sunday
    })

    it('returns false for Monday', () => {
      expect(isWeekend(new Date('2026-07-27'))).toBe(false) // Monday
    })
  })

  describe('shouldSendToday', () => {
    it('returns false on weekend when weekendSending is false', () => {
      const config = makeConfig({ weekendSending: false })
      expect(shouldSendToday(config, new Date('2026-07-25'))).toBe(false) // Saturday
    })

    it('returns true on weekend when weekendSending is true', () => {
      const config = makeConfig({ weekendSending: true })
      expect(shouldSendToday(config, new Date('2026-07-25'))).toBe(true)
    })

    it('returns true on weekday', () => {
      const config = makeConfig({ weekendSending: false })
      expect(shouldSendToday(config, new Date('2026-07-27'))).toBe(true) // Monday
    })
  })
})
