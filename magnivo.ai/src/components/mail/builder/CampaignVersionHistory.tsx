'use client'

import { useEffect, useState } from 'react'
import { Clock, RotateCcw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { CampaignVersion } from '@/types/campaign'

type Props = {
  campaignId: string
}

type FetchState =
  | { status: 'loading' }
  | { status: 'loaded'; versions: CampaignVersion[] }

export default function CampaignVersionHistory({ campaignId }: Props) {
  const [state, setState] = useState<FetchState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const { getVersionHistory } = await import('@/app/actions/campaigns')
        const result = await getVersionHistory(campaignId)
        if (!controller.signal.aborted) {
          setState(result.success ? { status: 'loaded', versions: result.data } : { status: 'loaded', versions: [] })
        }
      } catch {
        if (!controller.signal.aborted) setState({ status: 'loaded', versions: [] })
      }
    }
    load()
    return () => controller.abort()
  }, [campaignId])

  const handleRestore = async (versionId: string) => {
    try {
      const { restoreCampaignVersion } = await import('@/app/actions/campaigns')
      await restoreCampaignVersion({ campaignId, versionId })
      window.location.reload()
    } catch {
      // silent
    }
  }

  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Version History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {state.status === 'loading' ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : state.versions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No versions yet.</p>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {state.versions.map((v, i) => (
                <div
                  key={v.id}
                  className="flex items-start gap-2 py-2 px-2.5 rounded-lg border bg-background hover:bg-accent transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">v{v.versionNumber}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {v.changeSummary && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                        {v.changeSummary}
                      </p>
                    )}
                  </div>
                  {i > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRestore(v.id)}
                      className="h-6 px-2 shrink-0"
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
