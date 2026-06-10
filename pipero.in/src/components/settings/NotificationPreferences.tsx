'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { updateNotificationSettings } from '@/app/actions/crm'
import { toast } from 'sonner'
import { Loader2, Bell, Mail, Smartphone, CheckSquare, Users, Zap, Shield } from 'lucide-react'

const CATEGORIES = [
    {
        id: 'tasks',
        name: 'Tasks & Follow-ups',
        icon: CheckSquare,
        items: [
            { id: 'assigned', label: 'Task Assigned', desc: 'When a new task is assigned to you.' },
            { id: 'due', label: 'Task Due', desc: 'On the day a task is due.' },
            { id: 'overdue', label: 'Follow-up Overdue', desc: 'When a scheduled follow-up becomes overdue.' },
        ]
    },
    {
        id: 'leads',
        name: 'Leads & Deals',
        icon: Users,
        items: [
            { id: 'assigned', label: 'New Lead Assigned', desc: 'When a new lead is assigned to you manually or automatically.' },
            { id: 'risk', label: 'Deal at Risk', desc: 'When a deal you own is flagged as \'at risk\' by the system.' },
        ]
    },
    {
        id: 'ai',
        name: 'AI & Automation',
        icon: Zap,
        items: [
            { id: 'recommendation', label: 'AI Recommendation Available', desc: 'When the AI has a new suggestion for one of your leads or deals.' },
            { id: 'automation_failed', label: 'Automation Failed', desc: 'When an automation workflow that impacts you fails to run.' },
        ]
    },
    {
        id: 'system',
        name: 'System & Security',
        icon: Shield,
        items: [
            { id: 'security', label: 'Critical Security Alert', desc: 'For important security events like password changes or new device logins.' },
        ]
    }
]

export default function NotificationPreferences({ initialPrefs }: { initialPrefs: any }) {
    const [loading, setLoading] = useState(false)
    const [prefs, setPrefs] = useState(initialPrefs || {})

    const toggleMain = (catId: string, itemId: string, checked: boolean) => {
        const itemPrefs = prefs[catId]?.[itemId] || { in_app: true, email: true, push: true }
        setPrefs({
            ...prefs,
            [catId]: {
                ...prefs[catId],
                [itemId]: { ...itemPrefs, enabled: checked }
            }
        })
    }

    const toggleChannel = (catId: string, itemId: string, channel: string, checked: boolean) => {
        const itemPrefs = prefs[catId]?.[itemId] || { in_app: true, email: true, push: true }
        setPrefs({
            ...prefs,
            [catId]: {
                ...prefs[catId],
                [itemId]: { ...itemPrefs, [channel]: checked }
            }
        })
    }

    const handleSave = async () => {
        setLoading(true)
        try {
            await updateNotificationSettings(prefs)
            toast.success("Notification preferences saved")
        } catch (error) {
            toast.error("Failed to save preferences")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="space-y-1 mb-8">
                <h2 className="text-2xl font-semibold dark:text-foreground">Notifications</h2>
                <p className="text-slate-500 dark:text-muted-foreground">Control what notifications you receive, and how you receive them.</p>
            </div>

            <div className="space-y-12">
                {CATEGORIES.map((cat) => (
                    <div key={cat.id} className="space-y-4">
                        <div className="flex items-center gap-2 text-slate-900 dark:text-foreground font-bold mb-4">
                            <cat.icon className="w-5 h-5" />
                            <h3>{cat.name}</h3>
                        </div>

                        <div className="space-y-3">
                            {cat.items.map((item) => {
                                const current = prefs[cat.id]?.[item.id] || { in_app: true, email: true, push: true, enabled: true }
                                return (
                                    <div key={item.id} className="group flex flex-col md:flex-row md:items-center justify-between p-4 rounded-xl border border-slate-100 dark:border-border bg-white dark:bg-card/50 hover:border-slate-200 dark:hover:border-slate-700 transition-all">
                                        <div className="flex items-start gap-4 flex-1">
                                            <Switch
                                                checked={current.enabled !== false}
                                                onCheckedChange={(checked) => toggleMain(cat.id, item.id, checked)}
                                                className="mt-1 data-[state=checked]:bg-[#4f46e5]"
                                            />
                                            <div className="space-y-0.5 text-slate-900 dark:text-foreground">
                                                <h4 className="text-sm font-semibold">{item.label}</h4>
                                                <p className="text-xs text-slate-500 dark:text-muted-foreground">{item.desc}</p>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-6 mt-4 md:mt-0 ml-12 md:ml-0">
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id={`${cat.id}-${item.id}-in_app`}
                                                    checked={current.in_app !== false}
                                                    onCheckedChange={(c) => toggleChannel(cat.id, item.id, 'in_app', !!c)}
                                                    className="rounded-full border-slate-300 dark:border-border data-[state=checked]:bg-[#4f46e5] data-[state=checked]:border-[#4f46e5]"
                                                />
                                                <Label htmlFor={`${cat.id}-${item.id}-in_app`} className="text-xs flex items-center gap-1.5 cursor-pointer dark:text-muted-foreground">
                                                    <Bell className="w-3.5 h-3.5 text-slate-400 dark:text-muted-foreground" /> In-app
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id={`${cat.id}-${item.id}-email`}
                                                    checked={current.email !== false}
                                                    onCheckedChange={(c) => toggleChannel(cat.id, item.id, 'email', !!c)}
                                                    className="rounded-full border-slate-300 dark:border-border data-[state=checked]:bg-[#4f46e5] data-[state=checked]:border-[#4f46e5]"
                                                />
                                                <Label htmlFor={`${cat.id}-${item.id}-email`} className="text-xs flex items-center gap-1.5 cursor-pointer dark:text-muted-foreground">
                                                    <Mail className="w-3.5 h-3.5 text-slate-400 dark:text-muted-foreground" /> Email
                                                </Label>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id={`${cat.id}-${item.id}-push`}
                                                    checked={current.push !== false}
                                                    onCheckedChange={(c) => toggleChannel(cat.id, item.id, 'push', !!c)}
                                                    className="rounded-full border-slate-300 dark:border-border data-[state=checked]:bg-[#4f46e5] data-[state=checked]:border-[#4f46e5]"
                                                />
                                                <Label htmlFor={`${cat.id}-${item.id}-push`} className="text-xs flex items-center gap-1.5 cursor-pointer dark:text-muted-foreground">
                                                    <Smartphone className="w-3.5 h-3.5 text-slate-400 dark:text-muted-foreground" /> Push
                                                </Label>
                                            </div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-end pt-8 pb-12">
                <Button
                    onClick={handleSave}
                    disabled={loading}
                    className="bg-[#4f46e5] hover:bg-[#4338ca] text-white px-8 rounded-lg font-semibold h-10"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    Save Preferences
                </Button>
            </div>
        </div>
    )
}

