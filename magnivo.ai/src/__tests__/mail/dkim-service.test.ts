import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
}))

import {
  createSelector,
  verifySelector,
  deleteSelector,
} from '@/services/mail/dkim-service'

describe('dkim-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createSelector', () => {
    it('creates a selector successfully', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'dom-1', domain: 'example.com', organization_id: 'org-1' }],
        }) // domain lookup
        .mockResolvedValueOnce({ rows: [] }) // existing selector check
        .mockResolvedValueOnce({
          rows: [{
            id: 'sel-1',
            organization_id: 'org-1',
            domain_id: 'dom-1',
            selector: 's1',
            status: 'pending',
            public_key: null,
            key_length: null,
            last_verified_at: null,
            expires_at: null,
            rotated_at: null,
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }],
        }) // insert
        .mockResolvedValueOnce({ rows: [] }) // history

      const result = await createSelector('org-1', 'dom-1', 's1')
      expect(result.error).toBeUndefined()
      expect(result.selector).toBeTruthy()
      expect(result.selector?.selector).toBe('s1')
    })

    it('returns error when domain not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      const result = await createSelector('org-1', 'non-existent', 's1')
      expect(result.error).toBe('Domain not found')
    })

    it('returns error when selector already exists', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'dom-1' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'sel-existing', selector: 's1' }] })

      const result = await createSelector('org-1', 'dom-1', 's1')
      expect(result.error).toBe('Selector already exists')
    })
  })

  describe('deleteSelector', () => {
    it('returns error when selector not found', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] })
      const result = await deleteSelector('non-existent', 'org-1')
      expect(result.error).toBe('Selector not found')
    })

    it('prevents deleting active selector', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'sel-1', status: 'active' }],
      })
      const result = await deleteSelector('sel-1', 'org-1')
      expect(result.error).toContain('Cannot delete active selector')
    })
  })
})
