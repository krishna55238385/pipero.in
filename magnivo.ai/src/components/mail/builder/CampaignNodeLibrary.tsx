'use client'

import { useCallback, useMemo, useState } from 'react'
import { Search, GripVertical, Lock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { NODE_DEFINITIONS, NODE_CATEGORIES } from '@/lib/campaign-builder/constants'
import type { CampaignNodeType } from '@/types/campaign'
import * as Icons from 'lucide-react'

export default function CampaignNodeLibrary() {
  const addNode = useCampaignBuilderStore((s) => s.addNode)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return NODE_DEFINITIONS
    return NODE_DEFINITIONS.filter(
      (d) =>
        d.label.toLowerCase().includes(search.toLowerCase()) ||
        d.description.toLowerCase().includes(search.toLowerCase()),
    )
  }, [search])

  const onDragStart = useCallback(
    (e: React.DragEvent, nodeType: CampaignNodeType) => {
      e.dataTransfer.setData('application/campaignnode', nodeType)
      e.dataTransfer.effectAllowed = 'move'
    },
    [],
  )

  const categories = useMemo(() => {
    const map = new Map<string, typeof filtered>()
    for (const cat of NODE_CATEGORIES) {
      map.set(cat.key, filtered.filter((d) => d.category === cat.key))
    }
    return map
  }, [filtered])

  return (
    <Card className="rounded-2xl h-full overflow-hidden flex flex-col">
      <CardHeader className="pb-2 shrink-0">
        <CardTitle className="text-sm font-semibold">Node Library</CardTitle>
        <div className="relative mt-1.5">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes..."
            className="h-8 pl-8 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3 overflow-y-auto flex-1 min-h-0">
        {NODE_CATEGORIES.map((cat) => {
          const items = categories.get(cat.key) || []
          if (items.length === 0) return null
          return (
            <div key={cat.key}>
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
                {cat.label}
              </p>
              <div className="space-y-1">
                {items.map((def) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const IconComp = (Icons as any)[def.icon] || Icons.Circle
                  return (
                    <button
                      key={def.type}
                      type="button"
                      draggable={!def.disabled}
                      onDragStart={(e) => !def.disabled && onDragStart(e, def.type)}
                      onClick={() => !def.disabled && addNode(def.type)}
                      disabled={def.disabled}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors text-xs ${
                        def.disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'hover:bg-accent cursor-grab active:cursor-grabbing'
                      }`}
                    >
                      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100" />
                      <div className={`h-6 w-6 rounded-md ${def.bgColor} ${def.color} grid place-items-center shrink-0`}>
                        <IconComp className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{def.label}</p>
                      </div>
                      {def.comingSoon && (
                        <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
