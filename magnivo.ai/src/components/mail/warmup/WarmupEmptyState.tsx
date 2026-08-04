'use client'

import { Flame, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'

type WarmupEmptyStateProps = {
  type: 'no-warmups' | 'no-results'
  onAction?: () => void
}

export function WarmupEmptyState({ type, onAction }: WarmupEmptyStateProps) {
  if (type === 'no-warmups') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Flame className="size-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-1">No warmup processes</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Start a warmup to gradually build your sender reputation and improve deliverability.
        </p>
        {onAction && (
          <Button onClick={onAction}>Start Warmup</Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <SearchX className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-1">No results found</h3>
      <p className="text-sm text-muted-foreground max-w-sm">
        Try adjusting your filters or search query to find what you are looking for.
      </p>
    </div>
  )
}
