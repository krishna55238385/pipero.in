'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { updateOrganization } from '@/app/actions/crm'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'

export default function WorkspaceSettings({ initialData }: { initialData: any }) {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        name: initialData?.name || '',
        timezone: initialData?.timezone || '(UTC-05:00) Eastern Time',
        currency: initialData?.currency || 'USD'
    })

    const handleSave = async () => {
        setLoading(true)
        try {
            await updateOrganization(formData)
            toast.success("Workspace updated successfully")
        } catch (error) {
            toast.error("Failed to update workspace")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl overflow-hidden">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-semibold dark:text-foreground">Workspace</CardTitle>
                    <CardDescription className="text-slate-500 dark:text-muted-foreground">
                        Manage your organization's general settings.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8 pt-6">
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold dark:text-foreground">Workspace Name</Label>
                        <Input
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            disabled={!isCoreAdmin}
                            className="h-10 border-slate-200 dark:border-border bg-slate-50/50 dark:bg-background/50"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold dark:text-foreground">Timezone</Label>
                            <Select
                                value={formData.timezone}
                                onValueChange={(v) => setFormData({ ...formData, timezone: v })}
                                disabled={!isCoreAdmin}
                            >
                                <SelectTrigger className="h-10 border-slate-200 dark:border-border bg-slate-50/50 dark:bg-background/50">
                                    <SelectValue placeholder="Select timezone" />
                                </SelectTrigger>
                                <SelectContent className="dark:bg-card dark:border-border">
                                    <SelectItem value="(UTC-05:00) Eastern Time"> (UTC-05:00) Eastern Time</SelectItem>
                                    <SelectItem value="(UTC-08:00) Pacific Time">(UTC-08:00) Pacific Time</SelectItem>
                                    <SelectItem value="(UTC+00:00) London">(UTC+00:00) London</SelectItem>
                                    <SelectItem value="(UTC+05:30) Mumbai">(UTC+05:30) Mumbai</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold dark:text-foreground">Default Currency</Label>
                            <Select
                                value={formData.currency}
                                onValueChange={(v) => setFormData({ ...formData, currency: v })}
                                disabled={!isCoreAdmin}
                            >
                                <SelectTrigger className="h-10 border-slate-200 dark:border-border bg-slate-50/50 dark:bg-background/50">
                                    <SelectValue placeholder="Select currency" />
                                </SelectTrigger>
                                <SelectContent className="dark:bg-card dark:border-border">
                                    <SelectItem value="USD">USD - US Dollar</SelectItem>
                                    <SelectItem value="INR">INR - Indian Rupee</SelectItem>
                                    <SelectItem value="EUR">EUR - Euro</SelectItem>
                                    <SelectItem value="GBP">GBP - British Pound</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="flex justify-end p-6 pt-0">
                    {isCoreAdmin && (
                        <Button
                            onClick={handleSave}
                            disabled={loading}
                            className="bg-[#4f46e5] hover:bg-[#4338ca] text-white px-8 rounded-lg font-semibold h-10"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Save Changes
                        </Button>
                    )}
                </CardFooter>
            </Card>
        </div>
    )
}

