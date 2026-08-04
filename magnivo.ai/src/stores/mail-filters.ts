'use client'

import { create } from 'zustand'
import type {
  MailFilterState,
  MailCampaignFilterState,
  MailLeadFilterState,
  MailPoolFilterState,
  MailboxPaginationState,
  MailboxDetailDrawerState,
  MailboxSortField,
  MailboxHealth,
  MailboxStatus,
  MailboxProvider,
  WarmupStatus,
} from '@/types/mail'

type MailFiltersState = {
  mailboxFilters: MailFilterState
  poolFilters: MailPoolFilterState
  campaignFilters: MailCampaignFilterState
  leadFilters: MailLeadFilterState
  selectedMailboxId: string | null
  selectedCampaignId: string | null
  selectedPoolId: string | null
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'error'
  healthFilter: string
  setMailboxFilters: (filters: Partial<MailFilterState>) => void
  setPoolFilters: (filters: Partial<MailPoolFilterState>) => void
  setCampaignFilters: (filters: Partial<MailCampaignFilterState>) => void
  setLeadFilters: (filters: Partial<MailLeadFilterState>) => void
  setSelectedMailboxId: (id: string | null) => void
  setSelectedCampaignId: (id: string | null) => void
  setSelectedPoolId: (id: string | null) => void
  setConnectionStatus: (status: 'idle' | 'connecting' | 'connected' | 'error') => void
  setHealthFilter: (filter: string) => void
  resetMailboxFilters: () => void
  resetPoolFilters: () => void
  resetCampaignFilters: () => void
  resetLeadFilters: () => void

  dashboardSearch: string
  dashboardStatus: MailboxStatus | 'all'
  dashboardProvider: MailboxProvider | 'all'
  dashboardHealth: MailboxHealth | 'all'
  dashboardPoolId: string | 'all'
  dashboardWarmupStatus: WarmupStatus | 'all'
  dashboardSortBy: MailboxSortField
  dashboardSortDirection: 'asc' | 'desc'
  dashboardPagination: MailboxPaginationState
  selectedMailboxIds: Set<string>
  drawer: MailboxDetailDrawerState
  editingMailboxId: string | null

  setDashboardSearch: (search: string) => void
  setDashboardStatus: (status: MailboxStatus | 'all') => void
  setDashboardProvider: (provider: MailboxProvider | 'all') => void
  setDashboardHealth: (health: MailboxHealth | 'all') => void
  setDashboardPoolId: (poolId: string | 'all') => void
  setDashboardWarmupStatus: (status: WarmupStatus | 'all') => void
  setDashboardSort: (sortBy: MailboxSortField, sortDirection: 'asc' | 'desc') => void
  setDashboardPage: (page: number) => void
  setDashboardPageSize: (pageSize: number) => void
  setDashboardPagination: (pagination: Partial<MailboxPaginationState>) => void
  toggleMailboxSelection: (id: string) => void
  toggleAllMailboxSelection: (ids: string[]) => void
  clearMailboxSelection: () => void
  setDrawer: (drawer: Partial<MailboxDetailDrawerState>) => void
  setEditingMailboxId: (id: string | null) => void
  resetDashboardFilters: () => void
}

const defaultMailboxFilters: MailFilterState = {
  search: '',
  status: 'all',
  provider: 'all',
  sortBy: 'email',
  sortDirection: 'asc',
}

const defaultPoolFilters: MailPoolFilterState = {
  search: '',
  status: 'all',
  sortBy: 'name',
  sortDirection: 'asc',
}

const defaultCampaignFilters: MailCampaignFilterState = {
  search: '',
  status: 'all',
  mailboxId: 'all',
  sortBy: 'createdAt',
  sortDirection: 'desc',
}

const defaultLeadFilters: MailLeadFilterState = {
  search: '',
  status: 'all',
  source: 'all',
  sortBy: 'createdAt',
  sortDirection: 'desc',
}

const defaultPagination: MailboxPaginationState = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
}

export const useMailFiltersStore = create<MailFiltersState>((set) => ({
  mailboxFilters: defaultMailboxFilters,
  poolFilters: defaultPoolFilters,
  campaignFilters: defaultCampaignFilters,
  leadFilters: defaultLeadFilters,
  selectedMailboxId: null,
  selectedCampaignId: null,
  selectedPoolId: null,
  connectionStatus: 'idle',
  healthFilter: 'all',
  setMailboxFilters: (filters) =>
    set((state) => ({
      mailboxFilters: { ...state.mailboxFilters, ...filters },
    })),
  setPoolFilters: (filters) =>
    set((state) => ({
      poolFilters: { ...state.poolFilters, ...filters },
    })),
  setCampaignFilters: (filters) =>
    set((state) => ({
      campaignFilters: { ...state.campaignFilters, ...filters },
    })),
  setLeadFilters: (filters) =>
    set((state) => ({
      leadFilters: { ...state.leadFilters, ...filters },
    })),
  setSelectedMailboxId: (id) => set({ selectedMailboxId: id }),
  setSelectedCampaignId: (id) => set({ selectedCampaignId: id }),
  setSelectedPoolId: (id) => set({ selectedPoolId: id }),
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setHealthFilter: (filter) => set({ healthFilter: filter }),
  resetMailboxFilters: () => set({ mailboxFilters: defaultMailboxFilters }),
  resetPoolFilters: () => set({ poolFilters: defaultPoolFilters }),
  resetCampaignFilters: () => set({ campaignFilters: defaultCampaignFilters }),
  resetLeadFilters: () => set({ leadFilters: defaultLeadFilters }),

  dashboardSearch: '',
  dashboardStatus: 'all',
  dashboardProvider: 'all',
  dashboardHealth: 'all',
  dashboardPoolId: 'all',
  dashboardWarmupStatus: 'all',
  dashboardSortBy: 'createdAt',
  dashboardSortDirection: 'desc',
  dashboardPagination: defaultPagination,
  selectedMailboxIds: new Set<string>(),
  drawer: { open: false, mailboxId: null },
  editingMailboxId: null,

  setDashboardSearch: (search) => set({ dashboardSearch: search, dashboardPagination: { ...defaultPagination } }),
  setDashboardStatus: (status) => set({ dashboardStatus: status, dashboardPagination: { ...defaultPagination } }),
  setDashboardProvider: (provider) => set({ dashboardProvider: provider, dashboardPagination: { ...defaultPagination } }),
  setDashboardHealth: (health) => set({ dashboardHealth: health, dashboardPagination: { ...defaultPagination } }),
  setDashboardPoolId: (poolId) => set({ dashboardPoolId: poolId, dashboardPagination: { ...defaultPagination } }),
  setDashboardWarmupStatus: (status) => set({ dashboardWarmupStatus: status, dashboardPagination: { ...defaultPagination } }),
  setDashboardSort: (sortBy, sortDirection) => set({ dashboardSortBy: sortBy, dashboardSortDirection: sortDirection }),
  setDashboardPage: (page) =>
    set((state) => ({
      dashboardPagination: { ...state.dashboardPagination, page },
    })),
  setDashboardPageSize: (pageSize) =>
    set((state) => ({
      dashboardPagination: { ...state.dashboardPagination, pageSize, page: 1 },
    })),
  setDashboardPagination: (pagination) =>
    set((state) => ({
      dashboardPagination: { ...state.dashboardPagination, ...pagination },
    })),
  toggleMailboxSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedMailboxIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedMailboxIds: next }
    }),
  toggleAllMailboxSelection: (ids) =>
    set((state) => {
      const allSelected = ids.length > 0 && ids.every((id) => state.selectedMailboxIds.has(id))
      if (allSelected) {
        const next = new Set(state.selectedMailboxIds)
        ids.forEach((id) => next.delete(id))
        return { selectedMailboxIds: next }
      }
      const next = new Set(state.selectedMailboxIds)
      ids.forEach((id) => next.add(id))
      return { selectedMailboxIds: next }
    }),
  clearMailboxSelection: () => set({ selectedMailboxIds: new Set<string>() }),
  setDrawer: (drawer) =>
    set((state) => ({
      drawer: { ...state.drawer, ...drawer },
    })),
  setEditingMailboxId: (id) => set({ editingMailboxId: id }),
  resetDashboardFilters: () =>
    set({
      dashboardSearch: '',
      dashboardStatus: 'all',
      dashboardProvider: 'all',
      dashboardHealth: 'all',
      dashboardPoolId: 'all',
      dashboardWarmupStatus: 'all',
      dashboardSortBy: 'createdAt',
      dashboardSortDirection: 'desc',
      dashboardPagination: defaultPagination,
      selectedMailboxIds: new Set<string>(),
    }),
}))
