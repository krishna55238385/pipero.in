'use client'

import { useTransition, useEffect, useCallback, useState } from 'react'
import { Save, Undo2, Redo2, LayoutGrid, History, AlertTriangle, ChevronUp, Rocket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { BUILDER_SHORTCUTS } from '@/lib/campaign-builder/shortcuts'
import { launchCampaignAction } from '@/app/actions/campaigns'

type Props = {
  onToggleHistory?: () => void
  showHistory?: boolean
}

export default function CampaignBuilderToolbar({ onToggleHistory, showHistory }: Props) {
  const [pending, startTransition] = useTransition()
  const [launchError, setLaunchError] = useState<string | null>(null)
  const [launching, setLaunching] = useState(false)
  const meta = useCampaignBuilderStore((s) => s.meta)
  const setMeta = useCampaignBuilderStore((s) => s.setMeta)
  const save = useCampaignBuilderStore((s) => s.save)
  const undo = useCampaignBuilderStore((s) => s.undo)
  const redo = useCampaignBuilderStore((s) => s.redo)
  const autoLayout = useCampaignBuilderStore((s) => s.autoLayout)
  const saveState = useCampaignBuilderStore((s) => s.saveState)
  const validation = useCampaignBuilderStore((s) => s.validation)
  const isDirty = useCampaignBuilderStore((s) => s.isDirty)
  const undoStack = useCampaignBuilderStore((s) => s.undoStack)

  const handleSave = useCallback(() => {
    startTransition(async () => { await save() })
  }, [save])

  const handleLaunch = useCallback(() => {
    const campaignId = meta.id
    if (!campaignId) return
    setLaunchError(null)
    setLaunching(true)
    startTransition(async () => {
      if (isDirty) await save()
      const result = await launchCampaignAction(campaignId)
      setLaunching(false)
      if (!result.success) {
        setLaunchError(result.error || 'Launch failed')
        return
      }
      setMeta({ status: 'running' as typeof meta.status })
    })
  }, [meta.id, meta.status, isDirty, save, setMeta])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const key: string[] = []
      if (e.ctrlKey || e.metaKey) key.push('Ctrl')
      key.push(e.key.length === 1 ? e.key.toUpperCase() : e.key)
      const combo = key.join('+')

      const matched = BUILDER_SHORTCUTS.find((s) => s.key === combo)
      if (!matched) return

      e.preventDefault()
      switch (matched.action) {
        case 'save': handleSave(); break
        case 'undo': undo(); break
        case 'redo': redo(); break
        case 'autoLayout': autoLayout(); break
        case 'deselect': useCampaignBuilderStore.getState().setSelectedNode(null); break
      }
    },
    [handleSave, undo, redo, autoLayout],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const errorCount = validation.errors.reduce(
    (acc, e) => acc + e.errors.filter((er) => er.includes('missing') || er.includes('no_')).length,
    0,
  )
  const warnCount = validation.errors.reduce(
    (acc, e) => acc + e.errors.filter((er) => er.includes('orphan') || er.includes('disconnected')).length,
    0,
  )

  return (
    <div className="rounded-2xl border bg-card p-3 flex flex-wrap items-center gap-2 justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={meta.name}
          onChange={(e) => setMeta({ name: e.target.value })}
          placeholder="Campaign name"
          className="w-[260px] h-8 text-sm"
        />
        <Switch
          checked={meta.status === 'active'}
          onCheckedChange={(v) => setMeta({ status: v ? 'active' : 'draft' })}
          id="status-toggle"
        />
        <Label htmlFor="status-toggle" className="text-xs text-muted-foreground">
          {meta.status === 'active' ? 'Active' : 'Draft'}
        </Label>
      </div>

      <div className="flex items-center gap-1.5">
        {errorCount > 0 && (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-5">
            <AlertTriangle className="h-3 w-3 mr-1" />
            {errorCount}
          </Badge>
        )}
        {warnCount > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 text-amber-600 border-amber-300">
            {warnCount}
          </Badge>
        )}

        <div className="w-px h-5 bg-border mx-1" />

        <Button type="button" variant="ghost" size="sm" onClick={undo} disabled={undoStack.past.length === 0} className="h-8 px-2" title="Undo (Ctrl+Z)">
          <Undo2 className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={redo} disabled={undoStack.future.length === 0} className="h-8 px-2" title="Redo (Ctrl+Y)">
          <Redo2 className="h-3.5 w-3.5" />
        </Button>

        <div className="w-px h-5 bg-border mx-1" />

        <Button type="button" variant="ghost" size="sm" onClick={autoLayout} className="h-8 px-2" title="Auto-layout (Ctrl+L)">
          <LayoutGrid className="h-3.5 w-3.5" />
        </Button>

        {onToggleHistory && (
          <Button type="button" variant={showHistory ? 'secondary' : 'ghost'} size="sm" onClick={onToggleHistory} className="h-8 px-2" title="Version history">
            {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <History className="h-3.5 w-3.5" />}
          </Button>
        )}

        <div className="w-px h-5 bg-border mx-1" />

        {saveState.status === 'saved' && saveState.lastSavedAt && (
          <span className="text-[10px] text-emerald-600 mr-1">
            Saved {new Date(saveState.lastSavedAt).toLocaleTimeString()}
          </span>
        )}
        {saveState.status === 'error' && (
          <span className="text-[10px] text-destructive mr-1">{saveState.error}</span>
        )}

        <Button type="button" onClick={handleSave} disabled={pending || !isDirty} className="h-8 text-xs" size="sm">
          <Save className="h-3.5 w-3.5 mr-1.5" />
          {pending ? 'Saving...' : 'Save'}
        </Button>
        <Button
          type="button"
          onClick={handleLaunch}
          disabled={pending || launching || !meta.id || errorCount > 0}
          className="h-8 text-xs"
          size="sm"
          variant="default"
          title="Launch requires warm pool + compliance checklist"
        >
          <Rocket className="h-3.5 w-3.5 mr-1.5" />
          {launching ? 'Launching...' : 'Launch'}
        </Button>
      </div>
      {launchError && (
        <p className="w-full text-[11px] text-destructive mt-1">{launchError}</p>
      )}
    </div>
  )
}
