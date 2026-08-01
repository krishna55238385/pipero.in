'use client'

import { useEffect, useState } from 'react'
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
import { toast } from 'sonner'
import { Loader2, CheckCircle2, KeyRound, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/components/providers/WorkspaceProvider'
import { getOrgApiKeyStatus, saveOrgApiKey, deleteOrgApiKey, type OrgApiKeyStatus } from '@/app/actions/apiKeys'

const OPENROUTER_MODELS = [
    { value: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B (default, fast)' },
    { value: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash (cheap)' },
    { value: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
    { value: 'openai/gpt-4o-mini', label: 'GPT-4o mini' },
]

export default function ApiKeysSettings() {
    const { userRole } = useWorkspace()
    const isCoreAdmin = userRole?.toLowerCase() === 'admin' || userRole?.toLowerCase() === 'super_admin'

    const [status, setStatus] = useState<OrgApiKeyStatus | null>(null)
    const [loadingStatus, setLoadingStatus] = useState(true)

    const [serpKey, setSerpKey] = useState('')
    const [serpSaving, setSerpSaving] = useState(false)
    const [serpDeleting, setSerpDeleting] = useState(false)

    const [orKey, setOrKey] = useState('')
    const [orModel, setOrModel] = useState(OPENROUTER_MODELS[0].value)
    const [orSaving, setOrSaving] = useState(false)
    const [orDeleting, setOrDeleting] = useState(false)

    useEffect(() => {
        getOrgApiKeyStatus()
            .then((s) => {
                setStatus(s)
                if (s.openrouter.model) setOrModel(s.openrouter.model)
            })
            .finally(() => setLoadingStatus(false))
    }, [])

    const handleSaveSerp = async () => {
        if (!serpKey.trim()) return
        setSerpSaving(true)
        try {
            const res = await saveOrgApiKey('serpapi', serpKey.trim())
            if (res.ok) {
                toast.success('SerpAPI key saved')
                setSerpKey('')
                setStatus((prev) => prev && { ...prev, serpapi: { isSet: true, updatedAt: new Date().toISOString() } })
            } else {
                toast.error(res.error || 'Failed to save SerpAPI key')
            }
        } catch {
            toast.error('Failed to save SerpAPI key')
        } finally {
            setSerpSaving(false)
        }
    }

    const handleDeleteSerp = async () => {
        setSerpDeleting(true)
        try {
            const res = await deleteOrgApiKey('serpapi')
            if (res.ok) {
                toast.success('SerpAPI key removed — falling back to platform default')
                setStatus((prev) => prev && { ...prev, serpapi: { isSet: false, updatedAt: null } })
            } else {
                toast.error(res.error || 'Failed to remove key')
            }
        } catch {
            toast.error('Failed to remove key')
        } finally {
            setSerpDeleting(false)
        }
    }

    const handleSaveOpenRouter = async () => {
        if (!orKey.trim()) return
        setOrSaving(true)
        try {
            const res = await saveOrgApiKey('openrouter', orKey.trim(), orModel)
            if (res.ok) {
                toast.success('OpenRouter key saved')
                setOrKey('')
                setStatus((prev) => prev && { ...prev, openrouter: { isSet: true, model: orModel, updatedAt: new Date().toISOString() } })
            } else {
                toast.error(res.error || 'Failed to save OpenRouter key')
            }
        } catch {
            toast.error('Failed to save OpenRouter key')
        } finally {
            setOrSaving(false)
        }
    }

    const handleDeleteOpenRouter = async () => {
        setOrDeleting(true)
        try {
            const res = await deleteOrgApiKey('openrouter')
            if (res.ok) {
                toast.success('OpenRouter key removed — falling back to platform default')
                setStatus((prev) => prev && { ...prev, openrouter: { isSet: false, model: null, updatedAt: null } })
            } else {
                toast.error(res.error || 'Failed to remove key')
            }
        } catch {
            toast.error('Failed to remove key')
        } finally {
            setOrDeleting(false)
        }
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="space-y-1">
                <h2 className="text-2xl font-semibold dark:text-foreground">Automation & AI</h2>
                <p className="text-sm text-slate-500 dark:text-muted-foreground">
                    Optionally bring your own SerpAPI and OpenRouter (LLM) keys for this workspace's agent pipelines.
                    If left blank, runs use the platform's shared keys.
                </p>
            </div>

            {/* SerpAPI */}
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl overflow-hidden">
                <CardHeader className="space-y-1">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg font-semibold dark:text-foreground flex items-center gap-2">
                            <KeyRound className="w-4 h-4 text-slate-400" />
                            SerpAPI Key
                        </CardTitle>
                        {!loadingStatus && status?.serpapi.isSet && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                            </span>
                        )}
                    </div>
                    <CardDescription className="text-slate-500 dark:text-muted-foreground">
                        Used by lead search and buying-signal agents. Isolates your runs from the platform's shared search quota.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold dark:text-foreground">
                            {status?.serpapi.isSet ? 'Replace key' : 'API Key'}
                        </Label>
                        <Input
                            type="password"
                            value={serpKey}
                            onChange={(e) => setSerpKey(e.target.value)}
                            disabled={!isCoreAdmin}
                            placeholder={status?.serpapi.isSet ? '••••••••••••••••' : 'Enter your SerpAPI key'}
                            className="h-10 border-slate-200 dark:border-border bg-slate-50/50 dark:bg-background/50"
                        />
                    </div>
                </CardContent>
                {isCoreAdmin && (
                    <CardFooter className="flex justify-end gap-2 p-6 pt-0">
                        {status?.serpapi.isSet && (
                            <Button
                                variant="outline"
                                onClick={handleDeleteSerp}
                                disabled={serpDeleting}
                                className="rounded-lg font-semibold h-10 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
                            >
                                {serpDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                Remove
                            </Button>
                        )}
                        <Button
                            onClick={handleSaveSerp}
                            disabled={serpSaving || !serpKey.trim()}
                            className="bg-[#4f46e5] hover:bg-[#4338ca] text-white px-8 rounded-lg font-semibold h-10"
                        >
                            {serpSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Save
                        </Button>
                    </CardFooter>
                )}
            </Card>

            {/* OpenRouter */}
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl overflow-hidden">
                <CardHeader className="space-y-1">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-lg font-semibold dark:text-foreground flex items-center gap-2">
                            <KeyRound className="w-4 h-4 text-slate-400" />
                            OpenRouter Key (LLM)
                        </CardTitle>
                        {!loadingStatus && status?.openrouter.isSet && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                            </span>
                        )}
                    </div>
                    <CardDescription className="text-slate-500 dark:text-muted-foreground">
                        Routes agent LLM calls (scoring, drafting, enrichment) through the model of your choice via OpenRouter.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-0">
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold dark:text-foreground">
                            {status?.openrouter.isSet ? 'Replace key' : 'API Key'}
                        </Label>
                        <Input
                            type="password"
                            value={orKey}
                            onChange={(e) => setOrKey(e.target.value)}
                            disabled={!isCoreAdmin}
                            placeholder={status?.openrouter.isSet ? '••••••••••••••••' : 'Enter your OpenRouter key'}
                            className="h-10 border-slate-200 dark:border-border bg-slate-50/50 dark:bg-background/50"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-sm font-semibold dark:text-foreground">Model</Label>
                        <Select value={orModel} onValueChange={setOrModel} disabled={!isCoreAdmin}>
                            <SelectTrigger className="h-10 border-slate-200 dark:border-border bg-slate-50/50 dark:bg-background/50">
                                <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                            <SelectContent className="dark:bg-card dark:border-border">
                                {OPENROUTER_MODELS.map((m) => (
                                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
                {isCoreAdmin && (
                    <CardFooter className="flex justify-end gap-2 p-6 pt-0">
                        {status?.openrouter.isSet && (
                            <Button
                                variant="outline"
                                onClick={handleDeleteOpenRouter}
                                disabled={orDeleting}
                                className="rounded-lg font-semibold h-10 text-red-600 border-red-200 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
                            >
                                {orDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                                Remove
                            </Button>
                        )}
                        <Button
                            onClick={handleSaveOpenRouter}
                            disabled={orSaving || !orKey.trim()}
                            className="bg-[#4f46e5] hover:bg-[#4338ca] text-white px-8 rounded-lg font-semibold h-10"
                        >
                            {orSaving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                            Save
                        </Button>
                    </CardFooter>
                )}
            </Card>
        </div>
    )
}
