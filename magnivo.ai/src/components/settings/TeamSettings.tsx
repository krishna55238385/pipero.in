'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Users, UserPlus, Shield, MoreVertical, Mail, ShieldCheck, UserMinus, Loader2, Search } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator
} from "@/components/ui/dropdown-menu"
import { manageTeamMember } from '@/app/actions/crm'
import { toast } from 'sonner'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'

export default function TeamSettings({ members }: { members: any[] }) {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const [loading, setLoading] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    const handleRoleChange = async (userId: string, newRole: string) => {
        setLoading(userId)
        try {
            await manageTeamMember(userId, { role: newRole })
            toast.success("Role updated successfully")
            // In a real app, you'd trigger a refresh or update local state
        } catch (error) {
            toast.error("Failed to update role")
        } finally {
            setLoading(null)
        }
    }

    const filteredMembers = members.filter(m =>
        m.full_name?.toLowerCase().includes(search.toLowerCase())
    )

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-[32px] overflow-hidden shadow-sm ring-1 ring-slate-100 dark:ring-slate-800">
                <CardHeader className="p-8 pb-4">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="space-y-1">
                            <CardTitle className="text-2xl font-black italic tracking-tighter flex items-center gap-3">
                                <Users className="w-6 h-6 text-blue-600" /> Team Infrastructure
                            </CardTitle>
                            <CardDescription className="font-medium text-slate-500">Manage member permissions and organizational access.</CardDescription>
                        </div>
                        {isCoreAdmin && (
                            <Button className="rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 h-11 px-6 font-black text-xs uppercase tracking-widest">
                                <UserPlus className="w-4 h-4 mr-2" /> Invite Member
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="p-8 pt-4">
                    <div className="relative mb-8">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                            placeholder="Find a team member..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-11 rounded-2xl border-slate-100 dark:border-border h-12 font-medium bg-slate-50/50 dark:bg-card/50 placeholder:text-slate-400"
                        />
                    </div>

                    <div className="space-y-4">
                        {filteredMembers.map((member) => (
                            <div key={member.id} className="group flex items-center justify-between p-5 rounded-[24px] bg-white dark:bg-background border border-slate-100 dark:border-border hover:border-blue-500/30 transition-all hover:shadow-lg hover:shadow-blue-500/5">
                                <div className="flex items-center gap-5">
                                    <div className="w-12 h-12 rounded-[18px] bg-slate-50 dark:bg-card flex items-center justify-center border border-slate-100 dark:border-border text-blue-600 font-black italic text-lg shadow-inner">
                                        {member.full_name?.charAt(0)}
                                    </div>
                                    <div className="space-y-0.5">
                                        <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-black text-slate-900 dark:text-foreground tracking-tight italic">{member.full_name}</h4>
                                            {member.role === 'admin' && (
                                                <Badge variant="outline" className="rounded-full px-2 py-0 h-4 bg-emerald-500/10 text-[9px] font-black uppercase tracking-tighter text-emerald-600 border-emerald-500/20">
                                                    Admin
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5 leading-none">
                                            <Mail className="w-3 h-3" /> member@magnivo.ai
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {isCoreAdmin && (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button variant="ghost" className="h-10 w-10 p-0 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900">
                                                    {loading === member.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreVertical className="w-4 h-4 text-slate-400" />}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="rounded-2xl border-slate-100 dark:border-border w-48 shadow-xl">
                                                <DropdownMenuItem onClick={() => handleRoleChange(member.id, member.role === 'admin' ? 'user' : 'admin')} className="rounded-xl h-10 font-bold text-xs p-3">
                                                    <ShieldCheck className="w-4 h-4 mr-2 text-blue-500" /> Make {member.role === 'admin' ? 'User' : 'Admin'}
                                                </DropdownMenuItem>
                                                <DropdownMenuSeparator className="bg-slate-100 dark:bg-secondary" />
                                                <DropdownMenuItem className="rounded-xl h-10 font-bold text-xs p-3 text-rose-500">
                                                    <UserMinus className="w-4 h-4 mr-2" /> Deactivate Account
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

