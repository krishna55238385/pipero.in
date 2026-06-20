'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Zap,
    MessageSquare,
    Mail,
    ExternalLink,
    CheckCircle2,
    Loader2,
    Plus,
    X,
    Settings2
} from "lucide-react"
import { saveIntegration } from '@/app/actions/crm'
import { toast } from 'sonner'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog"

const PROVIDERS = [
    {
        id: 'whatsapp',
        name: 'WhatsApp Business',
        desc: 'Connect via Interakt/Wati for messaging automation.',
        icon: MessageSquare,
        color: 'text-emerald-500',
        bg: 'bg-emerald-500/10'
    },
    {
        id: 'email',
        name: 'Email (SMTP)',
        desc: 'Sync organization emails for lead correspondence.',
        icon: Mail,
        color: 'text-blue-500',
        bg: 'bg-blue-500/10'
    },
    {
        id: 'intercom',
        name: 'Intercom',
        desc: 'Import leads directly from your live chat support.',
        icon: ExternalLink,
        color: 'text-indigo-500',
        bg: 'bg-indigo-500/10'
    }
]

export default function IntegrationSettings({ integrations }: { integrations: any[] }) {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'
    const [loading, setLoading] = useState<string | null>(null)
    const [selectedProvider, setSelectedProvider] = useState<any>(null)
    const [config, setConfig] = useState<any>({})

    const handleSave = async () => {
        setLoading(selectedProvider.id)
        try {
            await saveIntegration(selectedProvider.id, config)
            toast.success(`${selectedProvider.name} integrated successfully`)
            setSelectedProvider(null)
        } catch (error) {
            toast.error("Integration failed")
        } finally {
            setLoading(null)
        }
    }

    const isConnected = (id: string) => integrations.some(i => i.provider === id && i.is_active)

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Card className="bg-white dark:bg-background border-slate-100 dark:border-border rounded-[32px] overflow-hidden shadow-sm ring-1 ring-slate-100 dark:ring-slate-800">
                <CardHeader className="p-8 pb-4">
                    <CardTitle className="text-2xl font-black italic tracking-tighter flex items-center gap-3">
                        <Zap className="w-6 h-6 text-blue-600" /> Integrations Hub
                    </CardTitle>
                    <CardDescription className="font-medium text-slate-500">Connect your tech stack for cross-platform intelligence.</CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {PROVIDERS.map((provider) => {
                            const active = isConnected(provider.id)
                            return (
                                <Card key={provider.id} className="relative group bg-slate-50/50 dark:bg-card/10 border border-slate-100 dark:border-border rounded-[28px] hover:ring-2 hover:ring-blue-500/30 transition-all p-6">
                                    <div className="flex items-start justify-between mb-6">
                                        <div className={`w-12 h-12 rounded-2xl ${provider.bg} flex items-center justify-center text-blue-600`}>
                                            <provider.icon className={`w-6 h-6 ${provider.color}`} />
                                        </div>
                                        {active && (
                                            <Badge className="bg-emerald-500/10 text-emerald-500 border-0 rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest">
                                                Connected
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="space-y-2 mb-8">
                                        <h3 className="text-sm font-black italic tracking-tight">{provider.name}</h3>
                                        <p className="text-xs font-bold text-slate-400 leading-relaxed">{provider.desc}</p>
                                    </div>

                                    <div className="flex items-center gap-3">
                                        {isCoreAdmin ? (
                                            <Dialog open={selectedProvider?.id === provider.id} onOpenChange={(open) => {
                                                if (open) {
                                                    setSelectedProvider(provider)
                                                    const existing = integrations.find(i => i.provider === provider.id)
                                                    setConfig(existing?.config || {})
                                                } else setSelectedProvider(null)
                                            }}>
                                                <DialogTrigger asChild>
                                                    <Button variant="outline" className="flex-1 rounded-2xl border-slate-200 dark:border-border h-11 text-[10px] font-black uppercase tracking-widest hover:bg-white dark:hover:bg-slate-900 transition-all">
                                                        {active ? <Settings2 className="w-3.5 h-3.5 mr-2" /> : <Plus className="w-3.5 h-3.5 mr-2" />}
                                                        {active ? 'Manage' : 'Connect'}
                                                    </Button>
                                                </DialogTrigger>
                                                <DialogContent className="max-w-md bg-white dark:bg-background border-slate-100 dark:border-border rounded-[32px] p-8">
                                                    <DialogHeader>
                                                        <DialogTitle className="text-2xl font-black italic tracking-tighter flex items-center gap-3">
                                                            <provider.icon className={`w-6 h-6 ${provider.color}`} /> Connect {provider.name}
                                                        </DialogTitle>
                                                        <DialogDescription className="font-medium text-slate-500">Provide authentication keys to enable syncing.</DialogDescription>
                                                    </DialogHeader>
                                                    <div className="space-y-6 py-6 border-y border-slate-100 dark:border-border my-4">
                                                        <div className="space-y-2">
                                                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">API Endpoint / Base URL</Label>
                                                            <Input
                                                                placeholder="https://api.provider.com/v1"
                                                                value={config.endpoint || ''}
                                                                onChange={(e) => setConfig({ ...config, endpoint: e.target.value })}
                                                                className="rounded-2xl border-slate-100 dark:border-border h-12 font-bold"
                                                            />
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Secret API Key</Label>
                                                            <Input
                                                                type="password"
                                                                placeholder="sk_live_xxxxxxxxxx"
                                                                value={config.apiKey || ''}
                                                                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                                                                className="rounded-2xl border-slate-100 dark:border-border h-12 font-bold"
                                                            />
                                                        </div>
                                                    </div>
                                                    <DialogFooter>
                                                        <Button onClick={handleSave} disabled={!!loading} className="w-full rounded-2xl bg-blue-600 hover:bg-blue-700 h-12 font-black uppercase tracking-widest text-xs">
                                                            {loading === provider.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Authorize Connection'}
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        ) : (
                                            <Button variant="outline" disabled className="flex-1 rounded-2xl border-slate-200 dark:border-border h-11 text-[10px] font-black uppercase tracking-widest opacity-50">
                                                Admin only
                                            </Button>
                                        )}
                                        {active && isCoreAdmin && (
                                            <Button variant="ghost" className="rounded-2xl h-11 w-11 p-0 text-rose-500 hover:bg-rose-500/10">
                                                <X className="w-4 h-4" />
                                            </Button>
                                        )}
                                    </div>
                                </Card>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

