import { describe, it, expect } from 'vitest'
import {
  canTransition,
  getTargetStatusForAction,
  getStatusLabel,
  isActive,
  canEdit,
  canDelete,
} from '@/lib/campaign-state-machine'
import type { CampaignStatus, CampaignAuditAction } from '@/types/campaign'

describe('campaign-state-machine', () => {
  describe('canTransition', () => {
    it('allows draft -> scheduled', () => {
      const result = canTransition('draft', 'scheduled')
      expect(result.valid).toBe(true)
    })

    it('allows draft -> running', () => {
      const result = canTransition('draft', 'running')
      expect(result.valid).toBe(true)
    })

    it('allows draft -> archived', () => {
      const result = canTransition('draft', 'archived')
      expect(result.valid).toBe(true)
    })

    it('allows running -> paused', () => {
      const result = canTransition('running', 'paused')
      expect(result.valid).toBe(true)
    })

    it('allows running -> completed', () => {
      const result = canTransition('running', 'completed')
      expect(result.valid).toBe(true)
    })

    it('allows running -> stopped', () => {
      const result = canTransition('running', 'stopped')
      expect(result.valid).toBe(true)
    })

    it('allows paused -> running', () => {
      const result = canTransition('paused', 'running')
      expect(result.valid).toBe(true)
    })

    it('allows paused -> stopped', () => {
      const result = canTransition('paused', 'stopped')
      expect(result.valid).toBe(true)
    })

    it('allows stopped -> draft', () => {
      const result = canTransition('stopped', 'draft')
      expect(result.valid).toBe(true)
    })

    it('allows archived -> draft', () => {
      const result = canTransition('archived', 'draft')
      expect(result.valid).toBe(true)
    })

    it('allows failed -> draft', () => {
      const result = canTransition('failed', 'draft')
      expect(result.valid).toBe(true)
    })

    it('allows same-status transition (no-op)', () => {
      const result = canTransition('draft', 'draft')
      expect(result.valid).toBe(true)
    })

    it('rejects draft -> completed', () => {
      const result = canTransition('draft', 'completed')
      expect(result.valid).toBe(false)
    })

    it('rejects completed -> running', () => {
      const result = canTransition('completed', 'running')
      expect(result.valid).toBe(false)
    })

    it('rejects archived -> running', () => {
      const result = canTransition('archived', 'running')
      expect(result.valid).toBe(false)
    })

    it('includes reason in rejection', () => {
      const result = canTransition('draft', 'completed')
      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.reason).toContain('draft')
        expect(result.reason).toContain('completed')
      }
    })
  })

  describe('getTargetStatusForAction', () => {
    it('returns draft for created', () => {
      expect(getTargetStatusForAction('created', 'draft')).toBe('draft')
    })

    it('returns archived for archived', () => {
      expect(getTargetStatusForAction('archived', 'draft')).toBe('archived')
    })

    it('returns paused for paused', () => {
      expect(getTargetStatusForAction('paused', 'running')).toBe('paused')
    })

    it('returns running for resumed', () => {
      expect(getTargetStatusForAction('resumed', 'paused')).toBe('running')
    })

    it('returns draft for restored', () => {
      expect(getTargetStatusForAction('restored', 'archived')).toBe('draft')
    })

    it('returns draft for duplicated', () => {
      expect(getTargetStatusForAction('duplicated', 'running')).toBe('draft')
    })

    it('returns null for template_applied', () => {
      expect(getTargetStatusForAction('template_applied', 'draft')).toBeNull()
    })

    it('returns null for version_created', () => {
      expect(getTargetStatusForAction('version_created', 'draft')).toBeNull()
    })

    it('returns null for rollback', () => {
      expect(getTargetStatusForAction('rollback', 'draft')).toBeNull()
    })

    it('returns null for updated', () => {
      expect(getTargetStatusForAction('updated', 'draft')).toBeNull()
    })

    it('returns null for deleted', () => {
      expect(getTargetStatusForAction('deleted', 'draft')).toBeNull()
    })

    it('returns null for tags_updated', () => {
      expect(getTargetStatusForAction('tags_updated', 'draft')).toBeNull()
    })
  })

  describe('getStatusLabel', () => {
    it('returns correct labels', () => {
      expect(getStatusLabel('draft')).toBe('Draft')
      expect(getStatusLabel('scheduled')).toBe('Scheduled')
      expect(getStatusLabel('running')).toBe('Running')
      expect(getStatusLabel('paused')).toBe('Paused')
      expect(getStatusLabel('stopped')).toBe('Stopped')
      expect(getStatusLabel('completed')).toBe('Completed')
      expect(getStatusLabel('archived')).toBe('Archived')
      expect(getStatusLabel('failed')).toBe('Failed')
    })
  })

  describe('isActive', () => {
    it('returns true for running', () => {
      expect(isActive('running')).toBe(true)
    })

    it('returns true for scheduled', () => {
      expect(isActive('scheduled')).toBe(true)
    })

    it('returns false for draft', () => {
      expect(isActive('draft')).toBe(false)
    })

    it('returns false for paused', () => {
      expect(isActive('paused')).toBe(false)
    })

    it('returns false for completed', () => {
      expect(isActive('completed')).toBe(false)
    })
  })

  describe('canEdit', () => {
    it('allows edit on draft', () => {
      expect(canEdit('draft')).toBe(true)
    })

    it('allows edit on scheduled', () => {
      expect(canEdit('scheduled')).toBe(true)
    })

    it('allows edit on paused', () => {
      expect(canEdit('paused')).toBe(true)
    })

    it('rejects edit on running', () => {
      expect(canEdit('running')).toBe(false)
    })

    it('rejects edit on completed', () => {
      expect(canEdit('completed')).toBe(false)
    })
  })

  describe('canDelete', () => {
    it('allows delete on draft', () => {
      expect(canDelete('draft')).toBe(true)
    })

    it('allows delete on paused', () => {
      expect(canDelete('paused')).toBe(true)
    })

    it('allows delete on completed', () => {
      expect(canDelete('completed')).toBe(true)
    })

    it('rejects delete on running', () => {
      expect(canDelete('running')).toBe(false)
    })

    it('rejects delete on scheduled', () => {
      expect(canDelete('scheduled')).toBe(false)
    })
  })
})
