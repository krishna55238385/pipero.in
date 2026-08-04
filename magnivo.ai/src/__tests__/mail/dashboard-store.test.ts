import { describe, it, expect, beforeEach } from 'vitest'
import { useMailFiltersStore } from '@/stores/mail-filters'

describe('MailFiltersStore - Dashboard State', () => {
  beforeEach(() => {
    useMailFiltersStore.getState().resetDashboardFilters()
  })

  describe('dashboard search', () => {
    it('should have empty search by default', () => {
      expect(useMailFiltersStore.getState().dashboardSearch).toBe('')
    })

    it('should set search and reset page to 1', () => {
      useMailFiltersStore.getState().setDashboardPage(5)
      useMailFiltersStore.getState().setDashboardSearch('test@test.com')
      const state = useMailFiltersStore.getState()
      expect(state.dashboardSearch).toBe('test@test.com')
      expect(state.dashboardPagination.page).toBe(1)
    })
  })

  describe('dashboard filters', () => {
    it('should set provider filter and reset page', () => {
      useMailFiltersStore.getState().setDashboardPage(3)
      useMailFiltersStore.getState().setDashboardProvider('gmail')
      expect(useMailFiltersStore.getState().dashboardProvider).toBe('gmail')
      expect(useMailFiltersStore.getState().dashboardPagination.page).toBe(1)
    })

    it('should set status filter and reset page', () => {
      useMailFiltersStore.getState().setDashboardPage(2)
      useMailFiltersStore.getState().setDashboardStatus('connected')
      expect(useMailFiltersStore.getState().dashboardStatus).toBe('connected')
      expect(useMailFiltersStore.getState().dashboardPagination.page).toBe(1)
    })

    it('should set health filter', () => {
      useMailFiltersStore.getState().setDashboardHealth('excellent')
      expect(useMailFiltersStore.getState().dashboardHealth).toBe('excellent')
    })

    it('should set warmup status filter', () => {
      useMailFiltersStore.getState().setDashboardWarmupStatus('warming')
      expect(useMailFiltersStore.getState().dashboardWarmupStatus).toBe('warming')
    })

    it('should set pool id filter', () => {
      useMailFiltersStore.getState().setDashboardPoolId('pool-123')
      expect(useMailFiltersStore.getState().dashboardPoolId).toBe('pool-123')
    })
  })

  describe('dashboard sort', () => {
    it('should have default sort', () => {
      const state = useMailFiltersStore.getState()
      expect(state.dashboardSortBy).toBe('createdAt')
      expect(state.dashboardSortDirection).toBe('desc')
    })

    it('should set sort field and direction', () => {
      useMailFiltersStore.getState().setDashboardSort('email', 'asc')
      const state = useMailFiltersStore.getState()
      expect(state.dashboardSortBy).toBe('email')
      expect(state.dashboardSortDirection).toBe('asc')
    })
  })

  describe('dashboard pagination', () => {
    it('should have default pagination', () => {
      const state = useMailFiltersStore.getState().dashboardPagination
      expect(state.page).toBe(1)
      expect(state.pageSize).toBe(25)
      expect(state.total).toBe(0)
      expect(state.totalPages).toBe(0)
    })

    it('should set page', () => {
      useMailFiltersStore.getState().setDashboardPage(5)
      expect(useMailFiltersStore.getState().dashboardPagination.page).toBe(5)
    })

    it('should set page size and reset page to 1', () => {
      useMailFiltersStore.getState().setDashboardPage(3)
      useMailFiltersStore.getState().setDashboardPageSize(50)
      const state = useMailFiltersStore.getState().dashboardPagination
      expect(state.pageSize).toBe(50)
      expect(state.page).toBe(1)
    })

    it('should set pagination partial', () => {
      useMailFiltersStore.getState().setDashboardPagination({ total: 100, totalPages: 4 })
      const state = useMailFiltersStore.getState().dashboardPagination
      expect(state.total).toBe(100)
      expect(state.totalPages).toBe(4)
    })
  })

  describe('mailbox selection', () => {
    it('should start with empty selection', () => {
      expect(useMailFiltersStore.getState().selectedMailboxIds.size).toBe(0)
    })

    it('should toggle mailbox selection', () => {
      const store = useMailFiltersStore.getState()
      store.toggleMailboxSelection('mb-1')
      expect(useMailFiltersStore.getState().selectedMailboxIds.has('mb-1')).toBe(true)

      useMailFiltersStore.getState().toggleMailboxSelection('mb-1')
      expect(useMailFiltersStore.getState().selectedMailboxIds.has('mb-1')).toBe(false)
    })

    it('should select multiple mailboxes', () => {
      const store = useMailFiltersStore.getState()
      store.toggleMailboxSelection('mb-1')
      store.toggleMailboxSelection('mb-2')
      store.toggleMailboxSelection('mb-3')
      expect(useMailFiltersStore.getState().selectedMailboxIds.size).toBe(3)
    })

    it('should toggle all mailboxes', () => {
      const store = useMailFiltersStore.getState()
      store.toggleMailboxSelection('mb-1')
      store.toggleMailboxSelection('mb-2')

      useMailFiltersStore.getState().toggleAllMailboxSelection(['mb-1', 'mb-2', 'mb-3'])
      expect(useMailFiltersStore.getState().selectedMailboxIds.size).toBe(3)

      useMailFiltersStore.getState().toggleAllMailboxSelection(['mb-1', 'mb-2', 'mb-3'])
      expect(useMailFiltersStore.getState().selectedMailboxIds.size).toBe(0)
    })

    it('should clear selection', () => {
      const store = useMailFiltersStore.getState()
      store.toggleMailboxSelection('mb-1')
      store.toggleMailboxSelection('mb-2')
      useMailFiltersStore.getState().clearMailboxSelection()
      expect(useMailFiltersStore.getState().selectedMailboxIds.size).toBe(0)
    })
  })

  describe('drawer state', () => {
    it('should have closed drawer by default', () => {
      const state = useMailFiltersStore.getState().drawer
      expect(state.open).toBe(false)
      expect(state.mailboxId).toBeNull()
    })

    it('should open drawer with mailbox id', () => {
      useMailFiltersStore.getState().setDrawer({ open: true, mailboxId: 'mb-1' })
      const state = useMailFiltersStore.getState().drawer
      expect(state.open).toBe(true)
      expect(state.mailboxId).toBe('mb-1')
    })

    it('should close drawer', () => {
      useMailFiltersStore.getState().setDrawer({ open: true, mailboxId: 'mb-1' })
      useMailFiltersStore.getState().setDrawer({ open: false, mailboxId: null })
      const state = useMailFiltersStore.getState().drawer
      expect(state.open).toBe(false)
      expect(state.mailboxId).toBeNull()
    })
  })

  describe('resetDashboardFilters', () => {
    it('should reset all dashboard filters to defaults', () => {
      const store = useMailFiltersStore.getState()
      store.setDashboardSearch('test')
      store.setDashboardProvider('gmail')
      store.setDashboardStatus('connected')
      store.setDashboardHealth('excellent')
      store.setDashboardSort('email', 'asc')
      store.setDashboardPage(5)
      store.toggleMailboxSelection('mb-1')

      useMailFiltersStore.getState().resetDashboardFilters()

      const state = useMailFiltersStore.getState()
      expect(state.dashboardSearch).toBe('')
      expect(state.dashboardProvider).toBe('all')
      expect(state.dashboardStatus).toBe('all')
      expect(state.dashboardHealth).toBe('all')
      expect(state.dashboardSortBy).toBe('createdAt')
      expect(state.dashboardSortDirection).toBe('desc')
      expect(state.dashboardPagination.page).toBe(1)
      expect(state.selectedMailboxIds.size).toBe(0)
    })
  })
})
