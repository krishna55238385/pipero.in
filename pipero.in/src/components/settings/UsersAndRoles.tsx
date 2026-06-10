'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Users as UsersIcon,
    UserPlus,
    Shield,
    MoreVertical,
    ShieldCheck,
    Loader2,
    Plus,
    Trash2,
} from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from 'sonner'
import { inviteUser, revokeInvite, updateUserRole, toggleUserSuspension, removeUser, getRoles, updateRolePermissions, createRole, deleteRole } from '@/app/actions/crm'
import { format } from 'date-fns'
import { useEffect } from 'react'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { useRouter } from 'next/navigation'

export default function UsersAndRoles({ members, invites = [] }: { members: any[], invites?: any[] }) {
    const { userRole } = useWorkspace()
    const router = useRouter()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const [activeTab, setActiveTab] = useState('users')

    // Advanced Roles State
    const [roles, setRoles] = useState<any[]>([])
    const [selectedRole, setSelectedRole] = useState<any | null>(null)
    const [isSavingRole, setIsSavingRole] = useState(false)
    const [createRoleOpen, setCreateRoleOpen] = useState(false)
    const [creatingRole, setCreatingRole] = useState(false)
    const [deletingRoleId, setDeletingRoleId] = useState<string | null>(null)

    const tabs = [
        { id: 'users', label: 'Users', count: members.length },
        { id: 'roles', label: 'Roles & Permissions', count: Math.max(roles.length, 2) },
        { id: 'pending', label: 'Pending Invites', count: invites.length },
    ]

    const [inviteOpen, setInviteOpen] = useState(false)
    const [inviting, setInviting] = useState(false)

    useEffect(() => {
        if (roles.length === 0) {
            loadRoles()
        }
    }, [])

    const loadRoles = async () => {
        const fetchedRoles = await getRoles()
        setRoles(fetchedRoles)
        if (fetchedRoles.length > 0 && !selectedRole) {
            setSelectedRole(fetchedRoles[0])
        }
    }

    const handleDeleteRole = async (roleId: string, roleName: string) => {
        if (!isCoreAdmin) return
        const confirmed = window.confirm(`Delete the role "${roleName}"? This cannot be undone.`)
        if (!confirmed) return

        setDeletingRoleId(roleId)
        const res = await deleteRole(roleId)
        setDeletingRoleId(null)

        if (res.error) {
            toast.error(res.error)
            return
        }

        toast.success('Role deleted')

        // Refresh roles list and selection
        const updatedRoles = await getRoles()
        setRoles(updatedRoles)
        if (selectedRole?.id === roleId) {
            setSelectedRole(updatedRoles[0] || null)
        }
    }

    const handleRoleToggle = async (module: string, action: string, checked: boolean) => {
        if (!selectedRole) return

        // Deep copy the permissions object to mutate
        const newPermissions = JSON.parse(JSON.stringify(selectedRole.permissions || {}))

        if (!newPermissions[module]) newPermissions[module] = {}
        newPermissions[module][action] = checked

        // Optimistic UI Update
        setSelectedRole({ ...selectedRole, permissions: newPermissions })
        setRoles(roles.map(r => r.id === selectedRole.id ? { ...r, permissions: newPermissions } : r))

        // Auto-save
        setIsSavingRole(true)
        const res = await updateRolePermissions(selectedRole.id, newPermissions)
        setIsSavingRole(false)
        if (res.error) {
            toast.error("Failed to save permission")
            // Revert on failure
            loadRoles()
        }
    }

    const handleInvite = async (formData: FormData) => {
        setInviting(true)
        const res = await inviteUser(formData)
        if (res.error) toast.error(res.error)
        else { toast.success('Invite sent successfully!'); setInviteOpen(false); router.refresh() }
        setInviting(false)
    }

    const handleCreateRole = async (formData: FormData) => {
        setCreatingRole(true)
        const name = formData.get('name') as string
        const description = formData.get('description') as string
        const res = await createRole(name, description)
        if (res.error) toast.error(res.error)
        else {
            toast.success('Role created!')
            setCreateRoleOpen(false)
            loadRoles()
        }
        setCreatingRole(false)
    }

    const permissionSchema = [
        { id: 'leads', label: 'Leads Management', actions: [{ id: 'view_all', label: 'View All Leads' }, { id: 'create', label: 'Create Leads' }, { id: 'edit', label: 'Edit Leads' }, { id: 'delete', label: 'Delete Leads' }] },
        { id: 'deals', label: 'Deals Pipeline', actions: [{ id: 'view_all', label: 'View All Deals' }, { id: 'create', label: 'Create Deals' }, { id: 'edit', label: 'Edit Deals' }, { id: 'delete', label: 'Delete Deals' }, { id: 'manage_stages', label: 'Manage Stages' }] },
        { id: 'tasks', label: 'Task Management', actions: [{ id: 'view_all', label: 'View All Tasks' }, { id: 'create', label: 'Create Tasks' }, { id: 'edit', label: 'Edit Tasks' }, { id: 'delete', label: 'Delete Tasks' }] },
        { id: 'global', label: 'Global Settings', actions: [{ id: 'manage_users', label: 'Manage Users & Roles' }, { id: 'manage_billing', label: 'Manage Billing' }] },
    ]

    const renderRolesAndPermissions = () => (
        <div className="flex flex-col md:flex-row gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Sidebar for Roles List */}
            <div className="w-full md:w-64 flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Available Roles</h3>
                </div>
                {roles.length === 0 && <div className="text-sm text-slate-400 p-4">Loading roles...</div>}
                {roles.map((role) => (
                    <button
                        key={role.id}
                        onClick={() => setSelectedRole(role)}
                        className={`flex items-center justify-between p-3 rounded-xl border transition-all text-left ${selectedRole?.id === role.id
                            ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-500/10 dark:border-indigo-500/30 shadow-sm'
                            : 'bg-white border-slate-100 hover:border-slate-300 dark:bg-card dark:border-border dark:hover:border-slate-700'}`}
                    >
                        <div>
                            <div className={`font-bold ${selectedRole?.id === role.id ? 'text-indigo-700 dark:text-indigo-400' : 'text-slate-900 dark:text-foreground'}`}>
                                {role.name}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{role.description}</div>
                        </div>
                        <div className="flex items-center gap-2">
                            {role.is_system && (
                                <ShieldCheck className={`w-4 h-4 ${selectedRole?.id === role.id ? 'text-indigo-500' : 'text-slate-400'}`} />
                            )}
                            {!role.is_system && isCoreAdmin && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteRole(role.id, role.name)
                                    }}
                                    className="inline-flex items-center justify-center w-7 h-7 rounded-full border border-transparent text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 dark:hover:bg-rose-500/10"
                                >
                                    {deletingRoleId === role.id
                                        ? <Loader2 className="w-3 h-3 animate-spin" />
                                        : <Trash2 className="w-3 h-3" />
                                    }
                                </button>
                            )}
                        </div>
                    </button>
                ))}

                {isCoreAdmin && (
                    <Button
                        variant="outline"
                        className="mt-2 w-full border-dashed border-2 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10"
                        onClick={() => setCreateRoleOpen(true)}
                    >
                        <Plus className="w-4 h-4 mr-2" /> Create Custom Role
                    </Button>
                )}
            </div>

            {/* Matrix Canvas for Permissions */}
            <div className="flex-1 bg-slate-50 dark:bg-card/30 rounded-2xl border border-slate-200 dark:border-border p-6 shadow-inner relative">
                {isSavingRole && (
                    <div className="absolute top-4 right-4 flex items-center gap-2 text-xs font-bold text-indigo-500 animate-pulse bg-white dark:bg-background px-3 py-1.5 rounded-full shadow-sm border border-indigo-100 dark:border-indigo-500/20">
                        <Loader2 className="w-3 h-3 animate-spin" /> Saving
                    </div>
                )}

                {selectedRole ? (
                    <div className="space-y-8">
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900 dark:text-foreground mb-1">{selectedRole.name} Permissions</h2>
                            <p className="text-sm text-slate-500">Enable or disable specific features across the CRM modules for this role.</p>
                        </div>

                        <div className="grid gap-4 md:gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
                            {permissionSchema.map((module) => (
                                <Card key={module.id} className="bg-white dark:bg-card border-none shadow-sm shadow-slate-200/50 dark:shadow-none ring-1 ring-slate-100 dark:ring-border">
                                    <CardHeader className="pb-3 border-b border-slate-100 dark:border-border px-4 md:px-6">
                                        <CardTitle className="text-base md:text-lg flex items-center gap-2 truncate">
                                            <div className="w-2 h-2 rounded-full bg-indigo-500 shrink-0"></div>
                                            <span className="truncate">{module.label}</span>
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="pt-4 space-y-4 px-4 md:px-6">
                                        {module.actions.map((action) => {
                                            const isChecked = selectedRole.permissions?.[module.id]?.[action.id] || false;
                                            // Prevent disabling global core admin permissions if it's the system Admin
                                            const isDisabled = selectedRole.name === 'Admin' && module.id === 'global' && action.id === 'manage_users';

                                            return (
                                                <div key={action.id} className="flex items-center justify-between gap-3 group">
                                                    <Label htmlFor={`${module.id}-${action.id}`} className="flex flex-col gap-1 cursor-pointer min-w-0">
                                                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors truncate">
                                                            {action.label}
                                                        </span>
                                                    </Label>
                                                    <Switch
                                                        id={`${module.id}-${action.id}`}
                                                        checked={isChecked}
                                                        disabled={isDisabled || !isCoreAdmin}
                                                        onCheckedChange={(c) => isCoreAdmin && handleRoleToggle(module.id, action.id, c)}
                                                        className="data-[state=checked]:bg-indigo-600 shrink-0"
                                                    />
                                                </div>
                                            )
                                        })}
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center py-20 text-slate-400">
                        <Shield className="w-12 h-12 mb-4 opacity-20" />
                        <p>Select a role from the sidebar to configure its permissions.</p>
                    </div>
                )}
            </div>
        </div>
    )

    const renderPendingInvites = () => (
        <div className="rounded-xl border border-slate-100 dark:border-border overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border">
                    <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Email</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Role</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Sent At</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-background">
                    {invites.length === 0 && (
                        <tr>
                            <td colSpan={4} className="px-6 py-8 text-center text-slate-500">No pending invites.</td>
                        </tr>
                    )}
                    {invites.map((invite) => (
                        <tr key={invite.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                            <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-foreground">{invite.email}</td>
                            <td className="px-6 py-4">
                                <Badge variant="outline" className="bg-slate-50 dark:bg-card text-slate-600 dark:text-muted-foreground border-slate-200 dark:border-border">
                                    {invite.role === 'admin' ? 'Admin' : 'Rep'}
                                </Badge>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-500">{format(new Date(invite.created_at), 'MMM d, yyyy')}</td>
                            <td className="px-6 py-4 text-right space-x-2">
                                {isCoreAdmin && (
                                    <Button
                                        variant="ghost" size="sm"
                                        className="text-rose-600 font-bold hover:bg-slate-100 dark:hover:bg-slate-800"
                                        onClick={async () => {
                                            toast.loading('Revoking...', { id: 'revoke' })
                                            const r = await revokeInvite(invite.id)
                                            if (r.error) toast.error(r.error, { id: 'revoke' })
                                            else toast.success('Invite revoked', { id: 'revoke' })
                                        }}
                                    >Revoke
                                    </Button>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

    const renderUsersTable = () => (
        <div className="rounded-xl border border-slate-100 dark:border-border overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-slate-50/50 dark:bg-card/50 border-b border-slate-100 dark:border-border">
                    <tr>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">User</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Role</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Workload</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">MFA</th>
                        <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Last Active</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-background">
                    {members.map((member) => (
                        <tr key={member.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/50 transition-colors">
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-secondary flex items-center justify-center text-xs font-bold text-indigo-600">
                                        {member.full_name?.charAt(0)}
                                    </div>
                                    <div className="text-sm font-semibold text-slate-900 dark:text-foreground">
                                        {member.full_name}
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4 truncate">
                                <Badge variant="outline" className={`rounded-full px-2 py-0 h-5 font-bold text-[10px] uppercase border-slate-200 dark:border-border ${(member.role_display || member.role || '').toLowerCase().includes('admin') ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600' : 'bg-slate-50 dark:bg-secondary text-slate-600 dark:text-muted-foreground'}`}>
                                    {member.role_display || member.role || 'Rep'}
                                </Badge>
                            </td>
                            <td className="px-6 py-4">
                                <div className={`flex items-center gap-1.5 text-xs font-semibold ${member.is_active ? 'text-emerald-600' : 'text-slate-400'}`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${member.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} /> {member.is_active ? 'Active' : 'Suspended'}
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <div className="flex flex-col gap-1">
                                    <div className="w-24 h-1.5 rounded-full bg-slate-100 dark:bg-secondary overflow-hidden">
                                        <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, (member.workload || 0) * 5)}%` }} />
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-bold">{member.workload || 0} assigned</span>
                                </div>
                            </td>
                            <td className="px-6 py-4">
                                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                            </td>
                            <td className="px-6 py-4 text-right text-xs font-medium text-slate-500">
                                {format(new Date(member.created_at), 'MMM d, yyyy')}
                            </td>
                            <td className="px-6 py-4 text-right">
                                {isCoreAdmin && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400">
                                                <MoreVertical className="h-4 w-4" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {roles.map(r => (
                                                <DropdownMenuItem
                                                    key={r.id}
                                                    onClick={async () => {
                                                        const loadingId = `role-${member.id}`
                                                        toast.loading(`Updating role to ${r.name}...`, { id: loadingId })
                                                        const res = await updateUserRole(member.id, r.name)
                                                        if ((res as any)?.error) {
                                                            toast.error((res as any).error, { id: loadingId })
                                                        } else {
                                                            toast.success('Role updated', { id: loadingId })
                                                            router.refresh()
                                                        }
                                                    }}
                                                >
                                                    Make {r.name}
                                                </DropdownMenuItem>
                                            ))}
                                            <DropdownMenuItem
                                                onClick={async () => {
                                                    const loadingId = `suspend-${member.id}`
                                                    toast.loading(member.is_active ? 'Suspending user...' : 'Restoring user...', { id: loadingId })
                                                    const res = await toggleUserSuspension(member.id, member.is_active)
                                                    if ((res as any)?.error) {
                                                        toast.error((res as any).error, { id: loadingId })
                                                    } else {
                                                        toast.success(member.is_active ? 'User suspended' : 'User restored', { id: loadingId })
                                                        router.refresh()
                                                    }
                                                }}
                                            >
                                                {member.is_active ? 'Suspend User' : 'Restore User'}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                className="text-red-500"
                                                onClick={async () => {
                                                    const confirmDelete = window.confirm(`Remove access for ${member.full_name}?`)
                                                    if (!confirmDelete) return
                                                    const loadingId = `remove-${member.id}`
                                                    toast.loading('Removing user...', { id: loadingId })
                                                    const res = await removeUser(member.id)
                                                    if ((res as any)?.error) {
                                                        toast.error((res as any).error, { id: loadingId })
                                                    } else {
                                                        toast.success('User removed', { id: loadingId })
                                                        router.refresh()
                                                    }
                                                }}
                                            >
                                                Remove Access
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between pb-4">
                    <div className="space-y-1">
                        <CardTitle className="text-2xl font-semibold dark:text-foreground">Users & Roles</CardTitle>
                        <CardDescription className="text-slate-500 dark:text-muted-foreground">
                            Manage who can access your CRM and what they can do.
                        </CardDescription>
                    </div>
                    {isCoreAdmin && (
                        <Button onClick={() => setInviteOpen(true)} className="bg-[#4f46e5] hover:bg-[#4338ca] text-white h-10 px-6 rounded-lg font-semibold flex items-center gap-2 shadow-md">
                            <UserPlus className="w-4 h-4" /> Invite User
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="pt-2">
                    {/* Horizontal Tabs */}
                    <div className="flex p-1 bg-slate-100 dark:bg-secondary rounded-lg mb-8 w-fit">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-6 py-2 text-sm font-semibold rounded-md transition-all ${activeTab === tab.id
                                    ? 'bg-white dark:bg-card text-slate-900 dark:text-foreground shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                    }`}
                            >
                                {tab.label} ({tab.count})
                            </button>
                        ))}
                    </div>

                    {activeTab === 'users' && renderUsersTable()}
                    {activeTab === 'roles' && renderRolesAndPermissions()}
                    {activeTab === 'pending' && renderPendingInvites()}
                </CardContent>
            </Card>

            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Invite Teammate</DialogTitle>
                        <DialogDescription>
                            Send an email invitation to join your workspace.
                        </DialogDescription>
                    </DialogHeader>
                    <form action={handleInvite}>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="email" className="text-right">Email</Label>
                                <Input id="email" name="email" type="email" placeholder="colleague@company.com" className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="role" className="text-right">Role</Label>
                                <Select name="role" defaultValue={roles.find(r => r.name === 'Sales Rep')?.name || "Sales Rep"}>
                                    <SelectTrigger className="col-span-3">
                                        <SelectValue placeholder="Select role" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {roles.map(r => (
                                            <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={inviting} className="bg-indigo-600 text-white hover:bg-indigo-700 w-full">
                                {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Send Invitation
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Create Custom Role Dialog */}
            <Dialog open={createRoleOpen} onOpenChange={setCreateRoleOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Create Custom Role</DialogTitle>
                        <DialogDescription>
                            Define a new role and then configure its precise permissions in the Matrix Canvas.
                        </DialogDescription>
                    </DialogHeader>
                    <form action={handleCreateRole}>
                        <div className="grid gap-4 py-4">
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="name" className="text-right font-bold">Role Name</Label>
                                <Input id="name" name="name" placeholder="e.g. Regional Manager" className="col-span-3" required />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <Label htmlFor="description" className="text-right font-bold">Description</Label>
                                <Input id="description" name="description" placeholder="Brief description of this role's purpose" className="col-span-3" required />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="submit" disabled={creatingRole} className="bg-indigo-600 text-white hover:bg-indigo-700 w-full">
                                {creatingRole ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                Create Role
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}

