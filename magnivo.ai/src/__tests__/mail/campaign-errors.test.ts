import { describe, it, expect } from 'vitest'
import {
  getCampaignErrorMessage,
  CAMPAIGN_ERROR_MESSAGES,
  type CampaignErrorCode,
} from '@/types/campaign'

describe('campaign error messages', () => {
  it('has messages for all error codes', () => {
    const codes: CampaignErrorCode[] = [
      'CAMPAIGN_NOT_FOUND',
      'CAMPAIGN_ALREADY_EXISTS',
      'CAMPAIGN_INVALID_STATUS',
      'CAMPAIGN_VALIDATION_FAILED',
      'CAMPAIGN_POOL_NOT_FOUND',
      'CAMPAIGN_POOL_UNHEALTHY',
      'CAMPAIGN_POOL_INACTIVE',
      'CAMPAIGN_FOLDER_NOT_FOUND',
      'CAMPAIGN_TEMPLATE_NOT_FOUND',
      'CAMPAIGN_VERSION_CONFLICT',
      'CAMPAIGN_CANNOT_DELETE',
      'CAMPAIGN_CANNOT_ARCHIVE',
      'CAMPAIGN_CANNOT_PAUSE',
      'CAMPAIGN_CANNOT_RESUME',
      'CAMPAIGN_DATABASE_FAILURE',
    ]
    for (const code of codes) {
      expect(CAMPAIGN_ERROR_MESSAGES[code]).toBeDefined()
      expect(typeof CAMPAIGN_ERROR_MESSAGES[code]).toBe('string')
      expect(CAMPAIGN_ERROR_MESSAGES[code].length).toBeGreaterThan(0)
    }
  })
})

describe('getCampaignErrorMessage', () => {
  it('maps not found', () => {
    expect(getCampaignErrorMessage('not found')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_NOT_FOUND)
  })

  it('maps duplicate', () => {
    expect(getCampaignErrorMessage('duplicate name')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_ALREADY_EXISTS)
  })

  it('maps already exists', () => {
    expect(getCampaignErrorMessage('already exists')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_ALREADY_EXISTS)
  })

  it('maps pool not found', () => {
    expect(getCampaignErrorMessage('pool not found')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_POOL_NOT_FOUND)
  })

  it('maps pool unhealthy', () => {
    expect(getCampaignErrorMessage('pool unhealthy')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_POOL_UNHEALTHY)
  })

  it('maps pool inactive', () => {
    expect(getCampaignErrorMessage('pool inactive')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_POOL_INACTIVE)
  })

  it('maps folder not found', () => {
    expect(getCampaignErrorMessage('folder not found')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_FOLDER_NOT_FOUND)
  })

  it('maps template not found', () => {
    expect(getCampaignErrorMessage('template not found')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_TEMPLATE_NOT_FOUND)
  })

  it('maps version conflict', () => {
    expect(getCampaignErrorMessage('version conflict')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_VERSION_CONFLICT)
  })

  it('maps cannot delete', () => {
    expect(getCampaignErrorMessage('cannot delete')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_DELETE)
  })

  it('maps cannot archive', () => {
    expect(getCampaignErrorMessage('cannot archive')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_ARCHIVE)
  })

  it('maps cannot pause', () => {
    expect(getCampaignErrorMessage('cannot pause')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_PAUSE)
  })

  it('maps cannot resume', () => {
    expect(getCampaignErrorMessage('cannot resume')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_CANNOT_RESUME)
  })

  it('maps database error', () => {
    expect(getCampaignErrorMessage('database error')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_DATABASE_FAILURE)
  })

  it('maps permission denied', () => {
    expect(getCampaignErrorMessage('permission denied')).toBe(CAMPAIGN_ERROR_MESSAGES.CAMPAIGN_VALIDATION_FAILED)
  })

  it('returns original message for unknown errors', () => {
    expect(getCampaignErrorMessage('something weird')).toBe('something weird')
  })
})
