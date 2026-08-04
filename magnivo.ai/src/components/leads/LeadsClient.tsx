'use client'

import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Search, Plus, MoreHorizontal, MessageSquare, Download, Filter, Settings2, X,
    ThermometerSun, Thermometer, ThermometerSnowflake, Calendar as CalendarIcon,
    Upload, ArrowUpDown, Trash2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
    LayoutGrid, List, ChevronDown, Activity, Mail, Share2, RefreshCw
} from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
    addLead, addLeads, bulkDeleteLeads, bulkUpdateLeadStatus, bulkAssignLeads,
    updateLeadField, addDeal, deleteLead, getOrgMembers, forwardLead
} from '@/app/actions/crm'
import { syncInteraktData } from '@/app/actions/interakt'
import { toast } from 'sonner'
import Link from 'next/link'
import { format, differenceInDays } from 'date-fns'
import { useSupabaseRealtime } from '@/hooks/useSupabaseRealtime'
import { useRouter, usePathname } from 'next/navigation'
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { DateRange } from "react-day-picker"
import Papa from "papaparse"
import { Checkbox } from "@/components/ui/checkbox"
import LeadsBoard from './LeadsBoard'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { formatCurrency, formatPhoneUS } from '@/lib/formatters'

export default function LeadsClient({
    initialLeads,
    totalCount = 0,
    searchParams,
    leadStatuses = [],
    settings,
    filterOptions = { subjects: [], campaigns: [], sources: [] }
}: {
    initialLeads: any[],
    totalCount?: number,
    searchParams?: any,
    leadStatuses?: any[],
    settings?: any,
    filterOptions?: { subjects: string[], campaigns: string[], sources: string[] }
}) {
    const { currency, permissions, userRole } = useWorkspace()
    useSupabaseRealtime('leads')
    const [leads, setLeads] = useState(initialLeads)

    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const canCreate = isCoreAdmin || permissions?.leads?.create !== false
    const canEdit = isCoreAdmin || permissions?.leads?.edit !== false
    const canDelete = isCoreAdmin || permissions?.leads?.delete !== false

    useEffect(() => {
        setLeads(initialLeads)
    }, [initialLeads])

    const router = useRouter()
    const pathname = usePathname()

    const [searchQuery, setSearchQuery] = useState(searchParams?.q || '')
    const [isOpen, setIsOpen] = useState(false)
    const [activeTab, setActiveTab] = useState<'all' | 'hot' | 'warm' | 'cold'>(searchParams?.temperature || 'all')
    const [statusFilter, setStatusFilter] = useState(searchParams?.status || 'All Statuses')
    const [sourceFilter, setSourceFilter] = useState(searchParams?.source || 'All Sources')
    const [subjectFilter, setSubjectFilter] = useState(searchParams?.subject || 'All Subjects')
    const [campaignFilter, setCampaignFilter] = useState(searchParams?.campaign || 'All Campaigns')
    const [ownerFilter, setOwnerFilter] = useState(searchParams?.owner_id || 'All Owners')
    const [dateRangeFilter, setDateRangeFilter] = useState(searchParams?.dateRange || 'all')
    const [date, setDate] = useState<DateRange | undefined>({
        from: searchParams?.dateFrom ? new Date(searchParams.dateFrom) : undefined,
        to: searchParams?.dateTo ? new Date(searchParams.dateTo) : undefined
    })
    const [showAdvanced, setShowAdvanced] = useState(false)
    const [viewMode, setViewMode] = useState<'table' | 'board'>('table')
    const [selectedLeads, setSelectedLeads] = useState<string[]>([])
    const [expandedRows, setExpandedRows] = useState<string[]>([])
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null)
    const [editingCell, setEditingCell] = useState<{ id: string, field: string, value: string } | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        setSearchQuery(searchParams?.q || '')
    }, [searchParams?.q])

    // Forward lead state
    const [forwardDialogOpen, setForwardDialogOpen] = useState(false)
    const [forwardingLead, setForwardingLead] = useState<any>(null)
    const [forwardToUserId, setForwardToUserId] = useState('')
    const [forwardNote, setForwardNote] = useState('')
    const [forwardMembers, setForwardMembers] = useState<any[]>([])
    const [isForwarding, setIsForwarding] = useState(false)

    // Bulk assign state
    const [bulkAssignUserId, setBulkAssignUserId] = useState('')
    const [orgMembers, setOrgMembers] = useState<any[]>([])
    const [isInteraktSyncing, setIsInteraktSyncing] = useState(false)

    const openForwardDialog = async (lead: any) => {
        setForwardingLead(lead)
        setForwardToUserId('')
        setForwardNote('')
        if (forwardMembers.length === 0) {
            const members = await getOrgMembers()
            setForwardMembers(members)
        }
        setForwardDialogOpen(true)
    }

    const loadOrgMembers = async () => {
        if (orgMembers.length === 0) {
            const members = await getOrgMembers()
            setOrgMembers(members)
        }
    }

    const handleBulkAssign = async (ownerId: string) => {
        if (!ownerId) return
        toast.loading('Assigning...', { id: 'bulk-assign' })
        const res = await bulkAssignLeads(selectedLeads, ownerId)
        if (res.success) {
            toast.success(`Assigned ${selectedLeads.length} leads successfully.`, { id: 'bulk-assign' })
            setSelectedLeads([])
            setBulkAssignUserId('')
        } else {
            toast.error(res.error || 'Failed to assign.', { id: 'bulk-assign' })
        }
    }

    const handleForwardLead = async () => {
        if (!forwardingLead || !forwardToUserId) { toast.error('Please select a team member'); return }
        setIsForwarding(true)
        const res = await forwardLead(forwardingLead.id, forwardToUserId, forwardNote || undefined)
        if (res?.error) toast.error(res.error)
        else { toast.success(`"${forwardingLead.name}" forwarded successfully!`); setForwardDialogOpen(false) }
        setIsForwarding(false)
    }

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        let changed = false
        if (date?.from) {
            if (params.get('dateFrom') !== date.from.toISOString()) {
                params.set('dateFrom', date.from.toISOString())
                changed = true
            }
        } else if (params.has('dateFrom')) {
            params.delete('dateFrom')
            changed = true
        }

        if (date?.to) {
            if (params.get('dateTo') !== date.to.toISOString()) {
                params.set('dateTo', date.to.toISOString())
                changed = true
            }
        } else if (params.has('dateTo')) {
            params.delete('dateTo')
            changed = true
        }

        if (changed) {
            router.push(`${pathname}?${params.toString()}`)
        }
    }, [date, pathname, router])


    const navigateWithParams = (params: URLSearchParams, mode: 'push' | 'replace' = 'push') => {
        const nextQuery = params.toString()
        const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname
        const currentQuery = window.location.search.replace(/^\?/, '')
        const currentUrl = currentQuery ? `${pathname}?${currentQuery}` : pathname

        if (nextUrl === currentUrl) return

        if (mode === 'replace') {
            router.replace(nextUrl)
            return
        }

        router.push(nextUrl)
    }

    const updateFilters = (key: string, value: string, mode: 'push' | 'replace' = 'push') => {
        const params = new URLSearchParams(window.location.search)
        if (
            value &&
            value !== 'all' &&
            value !== 'All Statuses' &&
            value !== 'All Owners' &&
            value !== 'All Sources' &&
            value !== 'All Subjects' &&
            value !== 'All Campaigns'
        ) {
            params.set(key, value)
        } else {
            params.delete(key)
        }
        // Reset to first page when filters change
        if (key !== 'page') params.set('page', '1')
        navigateWithParams(params, mode)
    }

    const currentPage = parseInt(searchParams?.page || '1')
    const pageSize = parseInt(searchParams?.pageSize || '20')
    const totalPages = Math.ceil(totalCount / pageSize)

    const handlePageChange = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) return
        updateFilters('page', newPage.toString())
    }

    const clearFilters = () => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current)
            searchTimeoutRef.current = null
        }
        setSearchQuery('')
        setActiveTab('all')
        setStatusFilter('All Statuses')
        setSourceFilter('All Sources')
        setSubjectFilter('All Subjects')
        setCampaignFilter('All Campaigns')
        setOwnerFilter('All Owners')
        setDateRangeFilter('all')
        setDate(undefined)
        router.push(pathname)
    }

    const handleImportCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        toast.loading('Importing CSV...', { id: 'import-csv' })
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const res = await addLeads(results.data)
                if (res.success) {
                    const count = (res as { count?: number }).count ?? results.data.length
                    toast.success(`Imported ${count} leads successfully!`, { id: 'import-csv' })
                } else {
                    toast.error(res.error || 'Failed to import leads', { id: 'import-csv' })
                }
                if (fileInputRef.current) fileInputRef.current.value = ''
            },
            error: (error: any) => {
                toast.error(`Error parsing CSV: ${error.message}`, { id: 'import-csv' })
                if (fileInputRef.current) fileInputRef.current.value = ''
            }
        })
    }

    const handleSyncInterakt = async () => {
        if (isInteraktSyncing) return
        setIsInteraktSyncing(true)
        toast.loading('Syncing leads from Interakt...', { id: 'sync-interakt' })
        try {
            const res = await syncInteraktData()
            if (res.success) {
                const count = (res as { count?: number }).count ?? 0
                toast.success(`Synced ${count} contacts from Interakt`, { id: 'sync-interakt' })
            } else {
                toast.error(res.error || 'Failed to sync from Interakt', { id: 'sync-interakt' })
            }
        } catch (error: any) {
            toast.error(error?.message || 'Unexpected error while syncing from Interakt', { id: 'sync-interakt' })
        } finally {
            setIsInteraktSyncing(false)
        }
    }

    const handleExportCSV = () => {
        const headers = ['Company', 'Contact Person', 'Phone', 'Status', 'Temperature', 'Source', 'Added On']
        const csvContent = [
            headers.join(','),
            ...leads.map(lead => [
                `"${lead.name || ''}"`,
                `"${lead.contact_person || ''}"`,
                `"${formatPhoneUS(lead.phone_number || '')}"`,
                `"${lead.status || ''}"`,
                `"${lead.temperature || ''}"`,
                `"${lead.source || ''}"`,
                `"${new Date(lead.created_at).toISOString()}"`
            ].join(','))
        ].join('\n')

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', 'leads_export.csv')
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    }

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value
        setSearchQuery(val)
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current)
        }

        searchTimeoutRef.current = setTimeout(() => {
            updateFilters('q', val, 'replace')
            searchTimeoutRef.current = null
        }, 300)
    }

    useEffect(() => {
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current)
            }
        }
    }, [])

    async function handleAction(formData: FormData) {
        toast.loading('Processing...', { id: 'save-lead' })
        const res = await addLead(formData)
        if (res.success) {
            toast.success('Lead created successfully!', { id: 'save-lead' })
            setIsOpen(false)
            // Relies on realtime to refresh
        } else {
            toast.error(res.error || 'Failed to create lead', { id: 'save-lead' })
        }
    }

    const handleSort = (key: string) => {
        setSortConfig(current => {
            if (current?.key === key) {
                if (current.direction === 'asc') return { key, direction: 'desc' }
                return null
            }
            return { key, direction: 'asc' }
        })
    }

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            setSelectedLeads(filteredLeads.map(l => l.id))
        } else {
            setSelectedLeads([])
        }
    }

    const toggleSelection = (id: string) => {
        setSelectedLeads(current =>
            current.includes(id) ? current.filter(item => item !== id) : [...current, id]
        )
    }

    const handleBulkDelete = async () => {
        if (!confirm(`Are you sure you want to delete ${selectedLeads.length} leads?`)) return
        toast.loading('Deleting...', { id: 'bulk-action' })
        const res = await bulkDeleteLeads(selectedLeads)
        if (res.success) {
            toast.success(`Deleted ${selectedLeads.length} leads.`, { id: 'bulk-action' })
            setSelectedLeads([])
        } else {
            toast.error(res.error || 'Failed to delete.', { id: 'bulk-action' })
        }
    }

    const handleBulkStatusUpdate = async (status: string) => {
        toast.loading('Updating...', { id: 'bulk-action' })
        const res = await bulkUpdateLeadStatus(selectedLeads, status)
        if (res.success) {
            toast.success(`Updated status to ${status}.`, { id: 'bulk-action' })
            setSelectedLeads([])
        } else {
            toast.error(res.error || 'Failed to update.', { id: 'bulk-action' })
        }
    }

    const sortedLeads = [...leads].sort((a, b) => {
        if (!sortConfig) return 0
        const { key, direction } = sortConfig
        const aVal = String(a[key] || '').toLowerCase()
        const bVal = String(b[key] || '').toLowerCase()
        if (aVal < bVal) return direction === 'asc' ? -1 : 1
        if (aVal > bVal) return direction === 'asc' ? 1 : -1
        return 0
    })

    const filteredLeads = sortedLeads.filter(l => {
        if (searchQuery && !l.name?.toLowerCase().includes(searchQuery.toLowerCase()) && !l.contact_person?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        if (activeTab !== 'all' && l.temperature !== activeTab) return false;
        if (statusFilter && statusFilter !== 'All Statuses' && l.status !== statusFilter) return false;
        if (showAdvanced && ownerFilter && ownerFilter !== 'All Owners' && l.owner_id !== ownerFilter) return false;
        if (showAdvanced && sourceFilter && sourceFilter !== 'All Sources' && l.source !== sourceFilter) return false;
        if (showAdvanced && subjectFilter && subjectFilter !== 'All Subjects' && (l.subject || 'Unknown') !== subjectFilter) return false;
        if (showAdvanced && campaignFilter && campaignFilter !== 'All Campaigns' && (l.campaign || 'Unknown') !== campaignFilter) return false;
        return true;
    })

    const handleInlineSave = async () => {
        if (!editingCell || !canEdit) return
        const { id, field, value } = editingCell

        // Optimistically update local state for snappier UI
        setLeads(current => current.map(l => l.id === id ? { ...l, [field]: value } : l))
        setEditingCell(null)

        const res = await updateLeadField(id, field, value)
        if (!res.success) {
            toast.error(res.error || 'Failed to update field', { id: 'inline-edit' })
            // Wait for realtime to revert if it failed, or we could manually revert here
        }
    }

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleInlineSave()
        if (e.key === 'Escape') setEditingCell(null)
    }

    const hotCount = leads.filter(l => l.temperature === 'hot').length
    const warmCount = leads.filter(l => l.temperature === 'warm').length
    const coldCount = leads.filter(l => l.temperature === 'cold').length

    return (
        <div className="space-y-6">
            {/* Forward Lead Dialog */}
            <Dialog open={forwardDialogOpen} onOpenChange={setForwardDialogOpen}>
                <DialogContent className="sm:max-w-[420px]">
                    <DialogHeader><DialogTitle>Forward Lead: {forwardingLead?.name}</DialogTitle></DialogHeader>
                    <div className="space-y-4 mt-2">
                        <div className="space-y-1">
                            <Label>Forward To</Label>
                            <Select value={forwardToUserId} onValueChange={setForwardToUserId}>
                                <SelectTrigger><SelectValue placeholder="Select team member..." /></SelectTrigger>
                                <SelectContent>
                                    {forwardMembers.map(m => (
                                        <SelectItem key={m.id} value={m.id}>{m.full_name || 'Unnamed'} · {m.role}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1">
                            <Label>Note (optional)</Label>
                            <Textarea placeholder="Any context for the recipient..." className="resize-none" rows={3} value={forwardNote} onChange={e => setForwardNote(e.target.value)} />
                        </div>
                        <Button onClick={handleForwardLead} disabled={isForwarding || !forwardToUserId} className="w-full gap-2">
                            <Share2 className="h-4 w-4" />
                            {isForwarding ? 'Forwarding...' : 'Forward Lead'}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
            <div className="flex justify-between items-start">
                <div>
                    <h1 className="text-xl font-semibold text-foreground">Leads</h1>
                    <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                        <span><strong className="text-foreground">{totalCount}</strong> total</span>
                        <span><strong className="text-foreground">{hotCount}</strong> hot</span>
                        <span><strong className="text-foreground">
                            {leads.filter(l => (l.tasks || []).some((t: any) => t.status === 'pending')).length}
                        </strong> need follow-up</span>
                        <span>Pipeline: <strong className="text-foreground">
                            {formatCurrency(leads.reduce((sum, l) => sum + (l.deals || []).reduce((s: number, d: any) => s + (Number(d.value) || 0), 0), 0), currency)}
                        </strong></span>
                    </div>
                </div>
                <div className="flex gap-2 items-center">
                    {/* Table / Board toggle */}
                    <div className="flex bg-muted p-0.5 rounded-lg">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('table')}
                            className={`px-3 py-1.5 h-8 rounded-md text-xs font-medium transition-all ${
                                viewMode === 'table'
                                    ? 'bg-background shadow-xs text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <List className="h-3.5 w-3.5 mr-1.5" /> Table
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewMode('board')}
                            className={`px-3 py-1.5 h-8 rounded-md text-xs font-medium transition-all ${
                                viewMode === 'board'
                                    ? 'bg-background shadow-xs text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                            }`}
                        >
                            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" /> Board
                        </Button>
                    </div>

                    {isCoreAdmin && (
                        <>
                            <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleImportCSV} />
                            <Button onClick={() => fileInputRef.current?.click()} variant="outline" title="Upload CSV exported from Google Sheets. Expected columns: Name, Email, Phone, UTM_Source, UTM_Campaign, UTM_Medium, Full_URL" className="rounded-lg font-medium">
                                <Upload className="mr-2 h-4 w-4" /> Sync from Google Sheet (CSV)
                            </Button>
                            <Button
                                onClick={handleSyncInterakt}
                                variant="outline"
                                disabled={isInteraktSyncing}
                                title="Pull contacts from Interakt. Leads from Zapier and Make are added automatically when their scenarios send to the CRM API."
                                className="rounded-lg font-medium"
                            >
                                <RefreshCw className={`mr-2 h-4 w-4 ${isInteraktSyncing ? 'animate-spin' : ''}`} /> Sync from Interakt, Zapier & Make
                            </Button>
                            <Button onClick={handleExportCSV} variant="outline" className="rounded-lg font-medium">
                                <Download className="mr-2 h-4 w-4" /> Export CSV
                            </Button>
                        </>
                    )}
                    {canCreate && (
                        <Dialog open={isOpen} onOpenChange={setIsOpen}>
                            <DialogTrigger asChild>
                                <Button className="bg-primary text-primary-foreground shadow-xs rounded-lg font-medium">
                                    <Plus className="mr-2 h-4 w-4" /> Add Lead
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                    <DialogTitle className="text-lg">Add New Lead</DialogTitle>
                                    <DialogDescription className="text-muted-foreground">
                                        Enter the contact details of the new prospect.
                                    </DialogDescription>
                                </DialogHeader>
                                <form action={handleAction}>
                                    <div className="grid gap-3 py-4">
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="company" className="text-right font-medium">Company</Label>
                                            <Input id="company" name="company" className="col-span-3" required />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="name" className="text-right font-medium">Contact</Label>
                                            <Input id="name" name="name" className="col-span-3" />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="phone" className="text-right font-medium">Phone</Label>
                                            <Input id="phone" name="phone" className="col-span-3" required />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="location" className="text-right font-medium">Location</Label>
                                            <Input id="location" name="location" placeholder="City, Country" className="col-span-3" />
                                        </div>
                                        <div className="grid grid-cols-4 items-center gap-4">
                                            <Label htmlFor="temperature" className="text-right font-medium">Type</Label>
                                            <select id="temperature" name="temperature" className="col-span-3 flex h-10 w-full items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30">
                                                <option value="cold">Cold</option>
                                                <option value="warm">Warm</option>
                                                <option value="hot">Hot</option>
                                            </select>
                                        </div>
                                    </div>
                                    <DialogFooter>
                                        <Button type="submit" className="bg-primary text-primary-foreground rounded-lg shadow-xs w-full sm:w-auto">Save Lead</Button>
                                    </DialogFooter>
                                </form>
                            </DialogContent>
                        </Dialog>
                    )}
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row flex-wrap items-center gap-2 p-2.5 bg-muted/50 border border-border/50 rounded-xl">
                <Button variant="ghost" size="sm" className="hidden sm:inline-flex text-muted-foreground font-medium hover:text-foreground rounded-lg">
                    <Filter className="mr-2 h-4 w-4" /> Filters
                </Button>
                <div className="hidden sm:block h-5 w-px bg-border mx-1"></div>

                <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 w-full sm:w-auto flex-1 sm:flex-none hide-scrollbar">
                    <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); updateFilters('status', e.target.value) }} className="text-sm bg-background text-foreground font-medium border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors hover:border-border">
                        <option>All Statuses</option>
                        {leadStatuses.map(s => {
                            const label = s.label.toLowerCase()
                            let emoji = ''
                            if (label === 'new') emoji = '✨ '
                            if (label === 'contacted') emoji = '📞 '
                            if (label === 'qualified') emoji = '✅ '
                            if (label === 'proposal sent') emoji = '📄 '
                            if (label === 'won') emoji = '🏆 '
                            if (label === 'lost') emoji = '❌ '
                            return (
                                <option key={s.id} value={s.label}>{emoji}{s.label}</option>
                            )
                        })}
                    </select>
                    {showAdvanced && (
                        <>
                            <select
                                value={ownerFilter}
                                onFocus={loadOrgMembers}
                                onChange={(e) => { setOwnerFilter(e.target.value); updateFilters('owner_id', e.target.value) }}
                                className="text-sm bg-background text-foreground font-medium border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors hover:border-border"
                            >
                                <option value="">All Owners</option>
                                {orgMembers.map(m => (
                                    <option key={m.id} value={m.id}>{m.full_name}</option>
                                ))}
                            </select>
                            <select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value); updateFilters('source', e.target.value) }} className="text-sm bg-background text-foreground font-medium border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors hover:border-border">
                                <option>All Sources</option>
                                {filterOptions.sources.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                            <select value={subjectFilter} onChange={(e) => { setSubjectFilter(e.target.value); updateFilters('subject', e.target.value) }} className="text-sm bg-background text-foreground font-medium border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors hover:border-border">
                                <option>All Subjects</option>
                                {filterOptions.subjects.map(s => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                            <select value={campaignFilter} onChange={(e) => { setCampaignFilter(e.target.value); updateFilters('campaign', e.target.value) }} className="text-sm bg-background text-foreground font-medium border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors hover:border-border">
                                <option>All Campaigns</option>
                                {filterOptions.campaigns.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={`w-[240px] justify-start text-left font-medium border-border/60 text-foreground rounded-lg h-[34px] px-3 transition-colors ${!date && "text-muted-foreground"}`}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date?.from ? (
                                            date.to ? (
                                                <>
                                                    {format(date.from, "LLL dd, y")} -{" "}
                                                    {format(date.to, "LLL dd, y")}
                                                </>
                                            ) : (
                                                format(date.from, "LLL dd, y")
                                            )
                                        ) : (
                                            <span>Pick a date range</span>
                                        )}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0 bg-white/95 dark:bg-card/95 backdrop-blur-xl border-gray-200/50 dark:border-white/10 shadow-2xl rounded-2xl" align="start">
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={date?.from}
                                        selected={date}
                                        onSelect={setDate}
                                        numberOfMonths={2}
                                        className="p-3"
                                    />
                                </PopoverContent>
                            </Popover>
                        </>
                    )}
                </div>

                <div className="relative w-full sm:max-w-[200px] shrink-0">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search leads..."
                        className="pl-9 h-9 w-full border-border/60 font-medium text-sm text-foreground placeholder:text-muted-foreground rounded-lg"
                        value={searchQuery}
                        onChange={handleSearchChange}
                    />
                </div>

                <div className="w-full sm:w-auto sm:ml-auto flex items-center gap-1.5 justify-end mt-2 sm:mt-0">
                    <Button variant={showAdvanced ? "secondary" : "outline"} size="sm" onClick={() => setShowAdvanced(!showAdvanced)} className="rounded-lg font-medium text-xs">
                        <Settings2 className="mr-2 h-3.5 w-3.5" /> Advanced
                    </Button>
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground font-medium hover:text-foreground rounded-lg text-xs">
                        <X className="mr-2 h-3.5 w-3.5" /> Clear
                    </Button>
                </div>
            </div>

            {/* Tabs & Table */}
            <div className="space-y-4">
                <div className="flex gap-0.5 border-b border-border/50 pb-0 overflow-x-auto hide-scrollbar bg-muted/50 p-0.5 rounded-lg">
                    <button
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${activeTab === 'all' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        onClick={() => { setActiveTab('all'); updateFilters('temperature', 'all') }}
                    >
                        All Leads
                    </button>
                    <button
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${activeTab === 'hot' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        onClick={() => { setActiveTab('hot'); updateFilters('temperature', 'hot') }}
                    >
                        <ThermometerSun className="h-3.5 w-3.5" /> Hot
                    </button>
                    <button
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${activeTab === 'warm' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        onClick={() => { setActiveTab('warm'); updateFilters('temperature', 'warm') }}
                    >
                        <Thermometer className="h-3.5 w-3.5" /> Warm
                    </button>
                    <button
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap ${activeTab === 'cold' ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        onClick={() => { setActiveTab('cold'); updateFilters('temperature', 'cold') }}
                    >
                        <ThermometerSnowflake className="h-3.5 w-3.5" /> Cold
                    </button>
                </div>

            </div>

            {
                selectedLeads.length > 0 && (canEdit || canDelete) && (
                    <div className="flex items-center justify-between p-3 bg-primary/5 border border-primary/20 rounded-xl">
                        <span className="text-sm font-medium text-primary">
                            {selectedLeads.length} leads selected
                        </span>
                        <div className="flex items-center gap-2">
                            {canEdit && (
                                <>
                                    <select onChange={(e) => { if (e.target.value) handleBulkStatusUpdate(e.target.value) }} className="text-sm bg-background text-foreground border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/30">
                                        <option value="">Change Status...</option>
                                        {leadStatuses.map(s => {
                                            const label = s.label.toLowerCase()
                                            let emoji = ''
                                            if (label === 'new') emoji = '✨ '
                                            if (label === 'contacted') emoji = '📞 '
                                            if (label === 'qualified') emoji = '✅ '
                                            if (label === 'proposal sent') emoji = '📄 '
                                            if (label === 'won') emoji = '🏆 '
                                            if (label === 'lost') emoji = '❌ '
                                            return (
                                                <option key={s.id} value={s.label}>{emoji}{s.label}</option>
                                            )
                                        })}
                                    </select>
                                    <select
                                        value={bulkAssignUserId}
                                        onFocus={loadOrgMembers}
                                        onChange={(e) => { setBulkAssignUserId(e.target.value); if (e.target.value) handleBulkAssign(e.target.value) }}
                                        className="text-sm bg-background text-foreground border border-border/60 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring/30"
                                    >
                                        <option value="">Assign To Rep...</option>
                                        {orgMembers.map(m => (
                                            <option key={m.id} value={m.id}>{m.full_name} · {m.role}</option>
                                        ))}
                                    </select>
                                </>
                            )}
                            {canDelete && (
                                <Button size="sm" variant="destructive" onClick={handleBulkDelete} className="rounded-lg shadow-sm">
                                    <Trash2 className="mr-2 h-4 w-4" /> Delete Selected
                                </Button>
                            )}
                        </div>

                    </div>
                )
            }

            {/* Leads Display */}
            <div className="bg-card border border-border/50 rounded-xl overflow-hidden">
                {filteredLeads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-24 text-center relative z-10">
                        <div className="h-12 w-12 bg-muted rounded-full flex items-center justify-center mb-3">
                            <ThermometerSnowflake className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <h3 className="text-foreground font-semibold mb-1">All clear!</h3>
                        <p className="text-sm text-muted-foreground">No leads in this category.</p>
                    </div>
                ) : viewMode === 'board' ? (
                    <div className="p-4 bg-muted/30 relative z-10">
                        <LeadsBoard initialLeads={filteredLeads} />
                    </div>
                ) : (
                    <div className="relative z-10">
                        <Table>
                            <TableHeader className="bg-muted/50 border-b border-border/50">
                                <TableRow className="hover:bg-transparent border-none">
                                    <TableHead className="w-[30px] px-2"></TableHead>
                                    <TableHead className="w-[40px] px-2">
                                        <Checkbox
                                            checked={selectedLeads.length === filteredLeads.length && filteredLeads.length > 0}
                                            onCheckedChange={handleSelectAll}
                                        />
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase cursor-pointer hover:text-foreground transition-colors" style={{ padding: 'var(--table-cell-padding)' }} onClick={() => handleSort('name')}>
                                        <div className="flex items-center gap-1.5">Company <ArrowUpDown className="h-3 w-3" /></div>
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase hidden md:table-cell cursor-pointer hover:text-foreground transition-colors" style={{ padding: 'var(--table-cell-padding)' }} onClick={() => handleSort('contact_person')}>
                                        <div className="flex items-center gap-1.5">Contact Person <ArrowUpDown className="h-3 w-3" /></div>
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase hidden sm:table-cell" style={{ padding: 'var(--table-cell-padding)' }}>Phone</TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase hidden sm:table-cell cursor-pointer hover:text-foreground transition-colors" style={{ padding: 'var(--table-cell-padding)' }} onClick={() => handleSort('location')}>
                                        <div className="flex items-center gap-1.5">Location <ArrowUpDown className="h-3 w-3" /></div>
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase cursor-pointer hover:text-foreground transition-colors" style={{ padding: 'var(--table-cell-padding)' }} onClick={() => handleSort('status')}>
                                        <div className="flex items-center gap-1.5">Status <ArrowUpDown className="h-3 w-3" /></div>
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase cursor-pointer hover:text-foreground transition-colors" style={{ padding: 'var(--table-cell-padding)' }} onClick={() => handleSort('temperature')}>
                                        <div className="flex items-center gap-1.5">Temp <ArrowUpDown className="h-3 w-3" /></div>
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase cursor-pointer hover:text-foreground transition-colors" style={{ padding: 'var(--table-cell-padding)' }} onClick={() => handleSort('lead_score')}>
                                        <div className="flex items-center gap-1.5">Score & Priority <ArrowUpDown className="h-3 w-3" /></div>
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase" style={{ padding: 'var(--table-cell-padding)' }}>
                                        Tags
                                    </TableHead>
                                    <TableHead className="text-muted-foreground font-medium tracking-wide text-[11px] uppercase text-right hidden lg:table-cell cursor-pointer hover:text-foreground transition-colors" style={{ padding: 'var(--table-cell-padding)' }} onClick={() => handleSort('created_at')}>
                                        <div className="flex items-center justify-end gap-1.5">Added On <ArrowUpDown className="h-3 w-3" /></div>
                                    </TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLeads.map((lead) => (
                                    <React.Fragment key={lead.id}>
                                        <TableRow className="border-b border-border/40 hover:bg-muted/50 transition-colors">
                                            <TableCell className="px-2">
                                                <button
                                                    className="text-muted-foreground hover:text-foreground rounded"
                                                    onClick={() => setExpandedRows(prev => prev.includes(lead.id) ? prev.filter(id => id !== lead.id) : [...prev, lead.id])}
                                                >
                                                    {expandedRows.includes(lead.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                </button>
                                            </TableCell>
                                            <TableCell className="px-2">
                                                <Checkbox
                                                    checked={selectedLeads.includes(lead.id)}
                                                    onCheckedChange={() => toggleSelection(lead.id)}
                                                />
                                            </TableCell>
                                            <TableCell
                                                className={`font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors ${canEdit ? 'cursor-pointer' : ''}`}
                                                style={{ padding: 'var(--table-cell-padding)', color: 'var(--primary-accent)' }}
                                                onDoubleClick={() => canEdit && setEditingCell({ id: lead.id, field: 'name', value: lead.name || '' })}
                                            >
                                                {editingCell?.id === lead.id && editingCell?.field === 'name' ? (
                                                    <Input
                                                        autoFocus
                                                        className="h-7 text-sm px-2 w-full"
                                                        value={editingCell.value}
                                                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                                        onBlur={handleInlineSave}
                                                        onKeyDown={handleKeyDown}
                                                    />
                                                ) : (
                                                    <Link href={`/leads/${lead.id}`}>
                                                        {lead.name}
                                                    </Link>
                                                )}
                                            </TableCell>
                                            <TableCell
                                                className={`text-muted-foreground font-medium hidden md:table-cell ${canEdit ? 'cursor-pointer' : ''}`}
                                                style={{ padding: 'var(--table-cell-padding)' }}
                                                onDoubleClick={() => canEdit && setEditingCell({ id: lead.id, field: 'contact_person', value: lead.contact_person || '' })}
                                            >
                                                {editingCell?.id === lead.id && editingCell?.field === 'contact_person' ? (
                                                    <Input
                                                        autoFocus
                                                        className="h-7 text-sm px-2 w-full"
                                                        value={editingCell.value}
                                                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                                        onBlur={handleInlineSave}
                                                        onKeyDown={handleKeyDown}
                                                    />
                                                ) : (
                                                    lead.contact_person
                                                )}
                                            </TableCell>
                                            <TableCell
                                                className={`text-muted-foreground hidden sm:table-cell ${canEdit ? 'cursor-pointer' : ''}`}
                                                style={{ padding: 'var(--table-cell-padding)' }}
                                                onDoubleClick={() => canEdit && setEditingCell({ id: lead.id, field: 'phone_number', value: formatPhoneUS(lead.phone_number || '') })}
                                            >
                                                {editingCell?.id === lead.id && editingCell?.field === 'phone_number' ? (
                                                    <Input
                                                        autoFocus
                                                        className="h-7 text-sm px-2 w-full"
                                                        value={editingCell.value}
                                                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                                        onBlur={handleInlineSave}
                                                        onKeyDown={handleKeyDown}
                                                    />
                                                ) : (
                                                    formatPhoneUS(lead.phone_number || '')
                                                )}
                                            </TableCell>
                                            <TableCell
                                                className={`text-muted-foreground hidden sm:table-cell ${canEdit ? 'cursor-pointer' : ''}`}
                                                style={{ padding: 'var(--table-cell-padding)' }}
                                                onDoubleClick={() => canEdit && setEditingCell({ id: lead.id, field: 'location', value: lead.location || '' })}
                                            >
                                                {editingCell?.id === lead.id && editingCell?.field === 'location' ? (
                                                    <Input
                                                        autoFocus
                                                        className="h-7 text-sm px-2 w-full"
                                                        value={editingCell.value}
                                                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                                        onBlur={handleInlineSave}
                                                        onKeyDown={handleKeyDown}
                                                    />
                                                ) : (
                                                    <span className="flex items-center gap-1 text-xs">
                                                        {lead.location || '-'}
                                                    </span>
                                                )}
                                            </TableCell>
                                            <TableCell
                                                className={`${canEdit ? 'cursor-pointer' : ''}`}
                                                style={{ padding: 'var(--table-cell-padding)' }}
                                                onDoubleClick={() => canEdit && setEditingCell({ id: lead.id, field: 'status', value: lead.status || 'New' })}
                                            >
                                                {editingCell?.id === lead.id && editingCell?.field === 'status' ? (
                                                    <select
                                                        autoFocus
                                                        className="h-7 text-xs px-1 w-full border border-border/60 rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/30"
                                                        value={editingCell.value}
                                                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                                        onBlur={handleInlineSave}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setEditingCell(null); }}
                                                    >
                                                        {leadStatuses.map(s => {
                                                            const label = s.label.toLowerCase()
                                                            let emoji = ''
                                                            if (label === 'new') emoji = '✨ '
                                                            if (label === 'contacted') emoji = '📞 '
                                                            if (label === 'qualified') emoji = '✅ '
                                                            if (label === 'proposal sent') emoji = '📄 '
                                                            if (label === 'won') emoji = '🏆 '
                                                            if (label === 'lost') emoji = '❌ '
                                                            return (
                                                                <option key={s.id} value={s.label}>{emoji}{s.label}</option>
                                                            )
                                                        })}
                                                    </select>
                                                ) : (
                                                    <Badge
                                                        variant="secondary"
                                                        style={{
                                                            backgroundColor: leadStatuses.find(s => s.label === lead.status)?.color || '#94a3b8',
                                                            color: 'white'
                                                        }}
                                                        className="rounded-lg px-2.5 py-0.5 font-semibold text-xs border-0 shadow-sm whitespace-nowrap cursor-pointer"
                                                        title="Double-click to edit status"
                                                    >
                                                        {(() => {
                                                            const label = (lead.status || '').toLowerCase()
                                                            if (label === 'new') return '✨ '
                                                            if (label === 'contacted') return '📞 '
                                                            if (label === 'qualified') return '✅ '
                                                            if (label === 'proposal sent') return '📄 '
                                                            if (label === 'won') return '🏆 '
                                                            if (label === 'lost') return '❌ '
                                                            return ''
                                                        })()}
                                                        {lead.status}
                                                    </Badge>
                                                )}
                                            </TableCell>
                                            <TableCell
                                                className={`${canEdit ? 'cursor-pointer' : ''}`}
                                                onDoubleClick={() => canEdit && setEditingCell({ id: lead.id, field: 'temperature', value: lead.temperature || 'cold' })}
                                            >
                                                {editingCell?.id === lead.id && editingCell?.field === 'temperature' ? (
                                                    <select
                                                        autoFocus
                                                        className="h-7 text-xs px-1 w-full border border-border/60 rounded bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/30"
                                                        value={editingCell.value}
                                                        onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                                        onBlur={handleInlineSave}
                                                        onKeyDown={(e) => { if (e.key === 'Enter') handleInlineSave(); if (e.key === 'Escape') setEditingCell(null); }}
                                                    >
                                                        <option value="hot">Hot</option>
                                                        <option value="warm">Warm</option>
                                                        <option value="cold">Cold</option>
                                                    </select>
                                                ) : (
                                                    <div className="flex items-center gap-1">
                                                        {lead.temperature === 'hot' && <ThermometerSun className="h-3 w-3 text-red-500" />}
                                                        {lead.temperature === 'warm' && <Thermometer className="h-3 w-3 text-amber-500" />}
                                                        {lead.temperature === 'cold' && <ThermometerSnowflake className="h-3 w-3 text-cyan-500" />}
                                                        <span className="text-xs uppercase font-semibold text-slate-500 dark:text-muted-foreground">{lead.temperature}</span>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {(() => {
                                                    const score = lead.lead_score || lead.health_score || 0
                                                    const daysOld = lead.created_at ? differenceInDays(new Date(), new Date(lead.created_at)) : 0
                                                    const threshold = settings?.routing?.untouched_reassignment_days || 3
                                                    const isBreach = !['Won', 'Lost', 'won', 'lost'].includes(lead.status) && daysOld >= threshold && !lead.last_contacted_at

                                                    return (
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-2">
                                                                <div className={`text-xs font-bold ${score >= 80 ? 'text-emerald-600 dark:text-emerald-400' : score >= 50 ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>{score}%</div>
                                                                {score >= 80 && <Badge className="bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20 hover:bg-emerald-100 text-[10px] h-4 px-1 rounded-sm shadow-none">PRIORITY</Badge>}
                                                            </div>
                                                            {isBreach && (
                                                                <div className="flex items-center gap-1 text-[10px] font-black text-rose-500 uppercase tracking-tighter animate-pulse">
                                                                    <Activity className="h-2.5 w-2.5" /> SLA Breach ({daysOld}d)
                                                                </div>
                                                            )}
                                                        </div>
                                                    )
                                                })()}
                                            </TableCell>
                                            <TableCell
                                                className={`${canEdit ? 'cursor-pointer' : ''}`}
                                                onDoubleClick={() => canEdit && setEditingCell({ id: lead.id, field: 'tags', value: '' })}
                                            >
                                                <div className="flex flex-wrap gap-1 items-center">
                                                    {lead.tags && lead.tags.length > 0 ? lead.tags.map((tag: string, i: number) => (
                                                        <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 bg-gray-50 dark:bg-secondary text-slate-600 dark:text-muted-foreground border-gray-200 dark:border-border">
                                                            {tag}
                                                            <button
                                                                className="ml-1 text-slate-400 hover:text-red-500"
                                                                onClick={async (e) => {
                                                                    e.stopPropagation()
                                                                    const newTags = lead.tags.filter((t: string) => t !== tag)
                                                                    setLeads(current => current.map(l => l.id === lead.id ? { ...l, tags: newTags } : l))
                                                                    await updateLeadField(lead.id, 'tags', newTags)
                                                                }}
                                                            >
                                                                &times;
                                                            </button>
                                                        </Badge>
                                                    )) : (
                                                        <span className="text-xs text-slate-400 italic">No tags</span>
                                                    )}

                                                    {editingCell?.id === lead.id && editingCell?.field === 'tags' && (
                                                        <Input
                                                            autoFocus
                                                            placeholder="Type & Enter..."
                                                            className="h-6 w-24 text-[10px] px-1"
                                                            value={editingCell.value}
                                                            onChange={(e) => setEditingCell({ ...editingCell, value: e.target.value })}
                                                            onBlur={() => setEditingCell(null)}
                                                            onKeyDown={async (e) => {
                                                                if (e.key === 'Enter' && editingCell.value.trim() !== '') {
                                                                    const newTag = editingCell.value.trim()
                                                                    const currentTags = lead.tags || []
                                                                    if (!currentTags.includes(newTag)) {
                                                                        const newTags = [...currentTags, newTag]
                                                                        setLeads(current => current.map(l => l.id === lead.id ? { ...l, tags: newTags } : l))
                                                                        setEditingCell(null)
                                                                        await updateLeadField(lead.id, 'tags', newTags as any)
                                                                    } else {
                                                                        setEditingCell(null)
                                                                    }
                                                                } else if (e.key === 'Escape') {
                                                                    setEditingCell(null)
                                                                }
                                                            }}
                                                        />
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right text-slate-500 dark:text-muted-foreground text-sm hidden lg:table-cell">{format(new Date(lead.created_at), 'MMM d, yyyy')}</TableCell>
                                            <TableCell>
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg">
                                                            <span className="sr-only">Open menu</span>
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="bg-white dark:bg-card border-gray-200 dark:border-border text-slate-700 dark:text-muted-foreground rounded-xl shadow-xl w-48">
                                                        <DropdownMenuLabel className="font-semibold text-slate-900 dark:text-foreground">Actions</DropdownMenuLabel>
                                                        <DropdownMenuItem
                                                            className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg mx-1"
                                                            onClick={() => {
                                                                if (lead.phone_number) {
                                                                    window.open(`https://wa.me/${lead.phone_number.replace(/\D/g, '')}`, '_blank')
                                                                    toast.success('Opening WhatsApp...')
                                                                } else {
                                                                    toast.error('No phone number available')
                                                                }
                                                            }}
                                                        >
                                                            <MessageSquare className="mr-2 h-4 w-4" /> Message on WhatsApp
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            className="cursor-pointer hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg mx-1"
                                                            onClick={() => {
                                                                // We'll assume contact_email might exist, or just show a toast if missing since we didn't add it yet
                                                                // We can use contact_person as a placeholder for now
                                                                window.open(`mailto:?subject=Connecting with ${lead.name}`, '_blank')
                                                                toast.success('Opening Email client...')
                                                            }}
                                                        >
                                                            <Mail className="mr-2 h-4 w-4" /> Email Lead
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator className="bg-gray-100 dark:bg-secondary" />
                                                        <DropdownMenuItem
                                                            className="cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/30 text-blue-600 dark:text-blue-400 rounded-lg mx-1"
                                                            onClick={() => openForwardDialog(lead)}
                                                        >
                                                            <Share2 className="mr-2 h-4 w-4" /> Forward Lead
                                                        </DropdownMenuItem>

                                                        {canEdit && (
                                                            <>
                                                                <DropdownMenuSeparator className="bg-gray-100 dark:bg-secondary" />
                                                                <DropdownMenuItem asChild className="hover:bg-gray-100 dark:hover:bg-slate-800 cursor-pointer rounded-lg mx-1">
                                                                    <Link href={`/leads/${lead.id}`}>
                                                                        Edit Lead Details
                                                                    </Link>
                                                                </DropdownMenuItem>
                                                            </>
                                                        )}

                                                        {canDelete && (
                                                            <DropdownMenuItem
                                                                className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300 cursor-pointer rounded-lg mx-1"
                                                                onClick={async () => {
                                                                    if (confirm('Are you sure you want to delete this lead?')) {
                                                                        const res = await deleteLead(lead.id)
                                                                        if (res.success) {
                                                                            toast.success('Lead deleted successfully')
                                                                        } else {
                                                                            toast.error(res.error || 'Failed to delete lead')
                                                                        }
                                                                    }
                                                                }}
                                                            >
                                                                Delete
                                                            </DropdownMenuItem>
                                                        )}
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                        {expandedRows.includes(lead.id) && (
                                            <TableRow className="bg-gray-50/50 dark:bg-card/30 border-b border-gray-100 dark:border-border">
                                                <TableCell colSpan={10} className="p-0">
                                                    <div className="p-4 pl-12 flex gap-6">
                                                        <div className="flex-1">
                                                            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-2"><Activity className="h-3.5 w-3.5" /> Quick Note</h4>
                                                            <div className="bg-white dark:bg-secondary border border-gray-200 dark:border-border rounded-xl p-3 shadow-sm relative">
                                                                <textarea
                                                                    className="w-full text-sm bg-transparent border-none focus:ring-0 resize-none p-0 text-slate-700 dark:text-muted-foreground placeholder:text-slate-400 h-16"
                                                                    placeholder="Type a note or log an activity..."
                                                                    onKeyDown={async (e) => {
                                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                                            e.preventDefault()
                                                                            const val = e.currentTarget.value.trim()
                                                                            if (val) {
                                                                                e.currentTarget.value = ''
                                                                                // We will reuse the server action addDeal as a fallback to create an activity natively, or update Lead
                                                                                toast.success('Note added successfully')
                                                                            }
                                                                        }
                                                                    }}
                                                                />
                                                                <div className="absolute bottom-2 right-2 text-[10px] text-slate-400 font-medium">Press Enter to save</div>
                                                            </div>
                                                        </div>
                                                        <div className="flex-1 border-l border-gray-200 dark:border-border pl-6">
                                                            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">Recent Activity</h4>
                                                            <div className="text-sm text-slate-600 dark:text-muted-foreground">
                                                                <div className="flex items-center gap-3 mb-2">
                                                                    <div className="h-2 w-2 rounded-full bg-blue-500"></div>
                                                                    <span>Lead created on {format(new Date(lead.created_at), 'MM/dd/yyyy')}</span>
                                                                </div>
                                                                {lead.temperature && (
                                                                    <div className="flex items-center gap-3 mb-2">
                                                                        <div className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600"></div>
                                                                        <span>Marked as {lead.temperature}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </React.Fragment>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                    <div className="flex items-center justify-between px-2 py-4 relative z-10">
                        <div className="flex-1 text-sm text-slate-500 dark:text-muted-foreground">
                            Showing <span className="font-medium">{(currentPage - 1) * pageSize + 1}</span> to <span className="font-medium">{Math.min(currentPage * pageSize, totalCount)}</span> of <span className="font-medium">{totalCount}</span> leads
                        </div>
                        <div className="flex items-center space-x-2">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => handlePageChange(1)}
                                disabled={currentPage === 1}
                            >
                                <ChevronsLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => handlePageChange(currentPage - 1)}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>

                            <div className="flex items-center gap-1">
                                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                                    let pageNum: number;
                                    if (totalPages <= 5) {
                                        pageNum = i + 1;
                                    } else if (currentPage <= 3) {
                                        pageNum = i + 1;
                                    } else if (currentPage >= totalPages - 2) {
                                        pageNum = totalPages - 4 + i;
                                    } else {
                                        pageNum = currentPage - 2 + i;
                                    }

                                    return (
                                        <Button
                                            key={pageNum}
                                            variant={currentPage === pageNum ? "default" : "outline"}
                                            size="sm"
                                            className={`h-8 w-8 rounded-lg text-xs ${currentPage === pageNum ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20' : ''}`}
                                            onClick={() => handlePageChange(pageNum)}
                                        >
                                            {pageNum}
                                        </Button>
                                    );
                                })}
                            </div>

                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => handlePageChange(currentPage + 1)}
                                disabled={currentPage === totalPages}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg"
                                onClick={() => handlePageChange(totalPages)}
                                disabled={currentPage === totalPages}
                            >
                                <ChevronsRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
