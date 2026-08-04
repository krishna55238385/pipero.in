'use client'

import { create } from 'zustand'
import type {
  WarmupConfigStatus,
  WarmupStage,
  WarmupHealth,
  MailboxProvider,
} from '@/types/mail'

export type WarmupSortField =
  | 'email'
  | 'status'
  | 'stage'
  | 'health'
  | 'currentDay'
  | 'totalDays'
  | 'currentDailyTarget'
  | 'maxDailySends'
  | 'createdAt'

export type WarmupPaginationState = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export type WarmupDetailDrawerState = {
  open: boolean
  configId: string | null
}

type WarmupFiltersState = {
  search: string
  status: WarmupConfigStatus | 'all'
  stage: WarmupStage | 'all'
  health: WarmupHealth | 'all'
  provider: MailboxProvider | 'all'
  sortBy: WarmupSortField
  sortDirection: 'asc' | 'desc'
  pagination: WarmupPaginationState
  selectedIds: Set<string>
  drawer: WarmupDetailDrawerState
  editingConfigId: string | null

  setSearch: (search: string) => void
  setStatus: (status: WarmupConfigStatus | 'all') => void
  setStage: (stage: WarmupStage | 'all') => void
  setHealth: (health: WarmupHealth | 'all') => void
  setProvider: (provider: MailboxProvider | 'all') => void
  setSort: (sortBy: WarmupSortField, sortDirection: 'asc' | 'desc') => void
  setPage: (page: number) => void
  setPageSize: (pageSize: number) => void
  setPagination: (pagination: Partial<WarmupPaginationState>) => void
  toggleSelection: (id: string) => void
  toggleAllSelection: (ids: string[]) => void
  clearSelection: () => void
  setDrawer: (drawer: Partial<WarmupDetailDrawerState>) => void
  setEditingConfigId: (id: string | null) => void
  resetFilters: () => void
}

const defaultPagination: WarmupPaginationState = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
}

export const useWarmupFiltersStore = create<WarmupFiltersState>((set) => ({
  search: '',
  status: 'all',
  stage: 'all',
  health: 'all',
  provider: 'all',
  sortBy: 'createdAt',
  sortDirection: 'desc',
  pagination: defaultPagination,
  selectedIds: new Set<string>(),
  drawer: { open: false, configId: null },
  editingConfigId: null,

  setSearch: (search) => set({ search, pagination: { ...defaultPagination } }),
  setStatus: (status) => set({ status, pagination: { ...defaultPagination } }),
  setStage: (stage) => set({ stage, pagination: { ...defaultPagination } }),
  setHealth: (health) => set({ health, pagination: { ...defaultPagination } }),
  setProvider: (provider) => set({ provider, pagination: { ...defaultPagination } }),
  setSort: (sortBy, sortDirection) => set({ sortBy, sortDirection }),
  setPage: (page) =>
    set((state) => ({
      pagination: { ...state.pagination, page },
    })),
  setPageSize: (pageSize) =>
    set((state) => ({
      pagination: { ...state.pagination, pageSize, page: 1 },
    })),
  setPagination: (pagination) =>
    set((state) => ({
      pagination: { ...state.pagination, ...pagination },
    })),
  toggleSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    }),
  toggleAllSelection: (ids) =>
    set((state) => {
      const allSelected = ids.length > 0 && ids.every((id) => state.selectedIds.has(id))
      if (allSelected) {
        const next = new Set(state.selectedIds)
        ids.forEach((id) => next.delete(id))
        return { selectedIds: next }
      }
      const next = new Set(state.selectedIds)
      ids.forEach((id) => next.add(id))
      return { selectedIds: next }
    }),
  clearSelection: () => set({ selectedIds: new Set<string>() }),
  setDrawer: (drawer) =>
    set((state) => ({
      drawer: { ...state.drawer, ...drawer },
    })),
  setEditingConfigId: (id) => set({ editingConfigId: id }),
  resetFilters: () =>
    set({
      search: '',
      status: 'all',
      stage: 'all',
      health: 'all',
      provider: 'all',
      sortBy: 'createdAt',
      sortDirection: 'desc',
      pagination: defaultPagination,
      selectedIds: new Set<string>(),
    }),
}))
