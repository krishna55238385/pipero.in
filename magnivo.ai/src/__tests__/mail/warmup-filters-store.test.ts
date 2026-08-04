import { useWarmupFiltersStore, type WarmupSortField } from '@/stores/warmup-filters'
import type {
  WarmupConfigStatus,
  WarmupStage,
  WarmupHealth,
  MailboxProvider,
} from '@/types/mail'

describe('warmup-filters store', () => {
  beforeEach(() => {
    useWarmupFiltersStore.setState({
      search: '',
      status: 'all',
      stage: 'all',
      health: 'all',
      provider: 'all',
      sortBy: 'createdAt',
      sortDirection: 'desc',
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
      selectedIds: new Set<string>(),
      drawer: { open: false, configId: null },
      editingConfigId: null,
    })
  })

  describe('filter setters', () => {
    it('sets search and resets pagination', () => {
      const { setSearch } = useWarmupFiltersStore.getState()
      useWarmupFiltersStore.setState({ pagination: { page: 3, pageSize: 25, total: 100, totalPages: 4 } })
      setSearch('test@example.com')
      const state = useWarmupFiltersStore.getState()
      expect(state.search).toBe('test@example.com')
      expect(state.pagination.page).toBe(1)
    })

    it('sets status and resets pagination', () => {
      useWarmupFiltersStore.setState({ pagination: { page: 5, pageSize: 25, total: 100, totalPages: 4 } })
      useWarmupFiltersStore.getState().setStatus('running' as WarmupConfigStatus)
      const state = useWarmupFiltersStore.getState()
      expect(state.status).toBe('running')
      expect(state.pagination.page).toBe(1)
    })

    it('sets stage and resets pagination', () => {
      useWarmupFiltersStore.setState({ pagination: { page: 2, pageSize: 25, total: 50, totalPages: 2 } })
      useWarmupFiltersStore.getState().setStage('learning' as WarmupStage)
      const state = useWarmupFiltersStore.getState()
      expect(state.stage).toBe('learning')
      expect(state.pagination.page).toBe(1)
    })

    it('sets health and resets pagination', () => {
      useWarmupFiltersStore.getState().setHealth('warning' as WarmupHealth)
      expect(useWarmupFiltersStore.getState().health).toBe('warning')
    })

    it('sets provider and resets pagination', () => {
      useWarmupFiltersStore.getState().setProvider('gmail' as MailboxProvider)
      expect(useWarmupFiltersStore.getState().provider).toBe('gmail')
    })
  })

  describe('sort', () => {
    it('sets sort field and direction', () => {
      useWarmupFiltersStore.getState().setSort('email' as WarmupSortField, 'asc')
      const state = useWarmupFiltersStore.getState()
      expect(state.sortBy).toBe('email')
      expect(state.sortDirection).toBe('asc')
    })

    it('does not reset pagination on sort', () => {
      useWarmupFiltersStore.setState({ pagination: { page: 3, pageSize: 25, total: 100, totalPages: 4 } })
      useWarmupFiltersStore.getState().setSort('status' as WarmupSortField, 'desc')
      expect(useWarmupFiltersStore.getState().pagination.page).toBe(3)
    })
  })

  describe('pagination', () => {
    it('sets page', () => {
      useWarmupFiltersStore.getState().setPage(2)
      expect(useWarmupFiltersStore.getState().pagination.page).toBe(2)
    })

    it('sets page size and resets to page 1', () => {
      useWarmupFiltersStore.setState({ pagination: { page: 5, pageSize: 25, total: 200, totalPages: 8 } })
      useWarmupFiltersStore.getState().setPageSize(50)
      const state = useWarmupFiltersStore.getState()
      expect(state.pagination.pageSize).toBe(50)
      expect(state.pagination.page).toBe(1)
    })

    it('sets pagination partial', () => {
      useWarmupFiltersStore.getState().setPagination({ total: 100, totalPages: 4 })
      const state = useWarmupFiltersStore.getState()
      expect(state.pagination.total).toBe(100)
      expect(state.pagination.totalPages).toBe(4)
      expect(state.pagination.page).toBe(1)
    })
  })

  describe('selection', () => {
    it('toggles selection on', () => {
      useWarmupFiltersStore.getState().toggleSelection('id-1')
      expect(useWarmupFiltersStore.getState().selectedIds.has('id-1')).toBe(true)
    })

    it('toggles selection off', () => {
      useWarmupFiltersStore.getState().toggleSelection('id-1')
      useWarmupFiltersStore.getState().toggleSelection('id-1')
      expect(useWarmupFiltersStore.getState().selectedIds.has('id-1')).toBe(false)
    })

    it('toggles all selection on', () => {
      useWarmupFiltersStore.getState().toggleAllSelection(['id-1', 'id-2', 'id-3'])
      const ids = useWarmupFiltersStore.getState().selectedIds
      expect(ids.has('id-1')).toBe(true)
      expect(ids.has('id-2')).toBe(true)
      expect(ids.has('id-3')).toBe(true)
    })

    it('toggles all selection off when all are selected', () => {
      useWarmupFiltersStore.getState().toggleAllSelection(['id-1', 'id-2'])
      useWarmupFiltersStore.getState().toggleAllSelection(['id-1', 'id-2'])
      const ids = useWarmupFiltersStore.getState().selectedIds
      expect(ids.has('id-1')).toBe(false)
      expect(ids.has('id-2')).toBe(false)
    })

    it('clears selection', () => {
      useWarmupFiltersStore.getState().toggleSelection('id-1')
      useWarmupFiltersStore.getState().toggleSelection('id-2')
      useWarmupFiltersStore.getState().clearSelection()
      expect(useWarmupFiltersStore.getState().selectedIds.size).toBe(0)
    })
  })

  describe('drawer', () => {
    it('opens drawer with configId', () => {
      useWarmupFiltersStore.getState().setDrawer({ open: true, configId: 'config-1' })
      const state = useWarmupFiltersStore.getState()
      expect(state.drawer.open).toBe(true)
      expect(state.drawer.configId).toBe('config-1')
    })

    it('closes drawer', () => {
      useWarmupFiltersStore.setState({ drawer: { open: true, configId: 'config-1' } })
      useWarmupFiltersStore.getState().setDrawer({ open: false, configId: null })
      const state = useWarmupFiltersStore.getState()
      expect(state.drawer.open).toBe(false)
      expect(state.drawer.configId).toBeNull()
    })
  })

  describe('editing', () => {
    it('sets editing config id', () => {
      useWarmupFiltersStore.getState().setEditingConfigId('config-abc')
      expect(useWarmupFiltersStore.getState().editingConfigId).toBe('config-abc')
    })

    it('clears editing config id', () => {
      useWarmupFiltersStore.getState().setEditingConfigId('config-abc')
      useWarmupFiltersStore.getState().setEditingConfigId(null)
      expect(useWarmupFiltersStore.getState().editingConfigId).toBeNull()
    })
  })

  describe('resetFilters', () => {
    it('resets all filters to defaults', () => {
      useWarmupFiltersStore.setState({
        search: 'test',
        status: 'running',
        stage: 'learning',
        health: 'warning',
        provider: 'gmail',
        sortBy: 'email' as WarmupSortField,
        sortDirection: 'asc',
        pagination: { page: 5, pageSize: 50, total: 200, totalPages: 4 },
        selectedIds: new Set(['id-1', 'id-2']),
      })
      useWarmupFiltersStore.getState().resetFilters()
      const state = useWarmupFiltersStore.getState()
      expect(state.search).toBe('')
      expect(state.status).toBe('all')
      expect(state.stage).toBe('all')
      expect(state.health).toBe('all')
      expect(state.provider).toBe('all')
      expect(state.sortBy).toBe('createdAt')
      expect(state.sortDirection).toBe('desc')
      expect(state.pagination).toEqual({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
      expect(state.selectedIds.size).toBe(0)
    })
  })
})
