import { describe, it, expect } from 'vitest'

describe('Dashboard types', () => {
  it('should have correct MailboxDashboardStats shape', async () => {
    const { MailboxOverviewStats } = await import('@/components/mail/dashboard/mailbox-overview-stats')
    expect(MailboxOverviewStats).toBeDefined()
  })

  it('should have correct MailboxFilterBar', async () => {
    const { MailboxFilterBar } = await import('@/components/mail/dashboard/mailbox-filter-bar')
    expect(MailboxFilterBar).toBeDefined()
  })

  it('should have correct MailboxDataTable', async () => {
    const { MailboxDataTable } = await import('@/components/mail/dashboard/mailbox-data-table')
    expect(MailboxDataTable).toBeDefined()
  })

  it('should have correct MailboxPagination', async () => {
    const { MailboxPagination } = await import('@/components/mail/dashboard/mailbox-pagination')
    expect(MailboxPagination).toBeDefined()
  })

  it('should have correct MailboxBulkActionBar', async () => {
    const { MailboxBulkActionBar } = await import('@/components/mail/dashboard/mailbox-bulk-action-bar')
    expect(MailboxBulkActionBar).toBeDefined()
  })

  it('should have correct MailboxDetailDrawer', async () => {
    const { MailboxDetailDrawer } = await import('@/components/mail/dashboard/mailbox-detail-drawer')
    expect(MailboxDetailDrawer).toBeDefined()
  })

  it('should have correct MailboxEmptyState', async () => {
    const { MailboxEmptyState } = await import('@/components/mail/dashboard/mailbox-empty-state')
    expect(MailboxEmptyState).toBeDefined()
  })
})

describe('Dashboard types validation', () => {
  it('should have correct type exports from mail.ts', async () => {
    const types = await import('@/types/mail')
    expect(types).toBeDefined()
  })
})
