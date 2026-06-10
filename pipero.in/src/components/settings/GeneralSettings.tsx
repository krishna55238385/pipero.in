'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Building, Globe, Coins, Palette, Upload, Loader2, CheckCircle2 } from "lucide-react"
import { updateOrganization } from '@/app/actions/crm'
import { toast } from 'sonner'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'

export default function GeneralSettings({ initialData }: { initialData: any }) {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        name: initialData?.name || '',
        timezone: initialData?.timezone || 'UTC',
        currency: initialData?.currency || 'INR',
        logo_url: initialData?.logo_url || ''
    })

    const handleSave = async () => {
        setLoading(true)
        try {
            await updateOrganization(formData)
            toast.success("Organization details updated successfully")
        } catch (error) {
            toast.error("Failed to update organization")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-[32px] overflow-hidden shadow-sm ring-1 ring-slate-100 dark:ring-slate-800">
                <CardHeader className="p-8 pb-4">
                    <CardTitle className="text-2xl font-black italic tracking-tighter flex items-center gap-3">
                        <Building className="w-6 h-6 text-blue-600" /> Organization Profile
                    </CardTitle>
                    <CardDescription className="font-medium text-slate-500">Manage your company identitiy and global preferences.</CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4 space-y-8">
                    {/* Logo Section */}
                    <div className="flex items-center gap-8 p-6 rounded-3xl bg-slate-50 dark:bg-card/50 border border-slate-100 dark:border-border/50">
                        <div className="w-20 h-20 rounded-[28px] bg-white dark:bg-background flex items-center justify-center border border-slate-200 dark:border-border relative shadow-sm overflow-hidden group cursor-pointer">
                            {formData.logo_url ? (
                                <img src={formData.logo_url} alt="Logo" className="w-full h-full object-contain p-4" />
                            ) : (
                                <Building className="w-8 h-8 text-slate-300 group-hover:text-blue-500 transition-colors" />
                            )}
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <Upload className="w-5 h-5 text-white" />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <h4 className="text-sm font-black italic tracking-tight">Organization Logo</h4>
                            <p className="text-xs font-medium text-slate-500">Upload a high-resolution PNG or SVG (max 2MB).</p>
                            <Button variant="ghost" size="sm" disabled={!isCoreAdmin} className="h-8 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-500/10 mt-2">
                                Change Image
                            </Button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Entity Name</Label>
                            <Input
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                disabled={!isCoreAdmin}
                                className="rounded-2xl border-slate-100 dark:border-border h-12 font-bold bg-slate-50/50 dark:bg-card/50"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Timezone</Label>
                            <div className="relative">
                                <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    value={formData.timezone}
                                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                                    disabled={!isCoreAdmin}
                                    className="pl-10 rounded-2xl border-slate-100 dark:border-border h-12 font-bold bg-slate-50/50 dark:bg-card/50"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Base Currency</Label>
                            <div className="relative">
                                <Coins className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    value={formData.currency}
                                    onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                                    disabled={!isCoreAdmin}
                                    className="pl-10 rounded-2xl border-slate-100 dark:border-border h-12 font-bold bg-slate-50/50 dark:bg-card/50"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Primary Color</Label>
                            <div className="relative">
                                <Palette className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                                <Input
                                    defaultValue="#2563eb"
                                    className="pl-10 rounded-2xl border-slate-100 dark:border-border h-12 font-bold bg-slate-50/50 dark:bg-card/50"
                                />
                            </div>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="bg-slate-50/50 dark:bg-card/50 border-t border-slate-100 dark:border-border p-8 flex justify-end">
                    {isCoreAdmin && (
                        <Button
                            onClick={handleSave}
                            disabled={loading}
                            className="rounded-2xl bg-blue-600 hover:bg-blue-700 h-12 px-8 font-black uppercase tracking-widest text-xs shadow-lg shadow-blue-500/20"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                            Save Changes
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    )
}

