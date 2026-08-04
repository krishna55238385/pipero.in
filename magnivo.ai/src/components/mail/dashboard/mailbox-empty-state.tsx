'use client'

import { Mail, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'

type MailboxEmptyStateProps = {
  type: 'no-mailboxes' | 'no-results'
  onAction?: () => void
}

export function MailboxEmptyState({ type, onAction }: MailboxEmptyStateProps) {
  if (type === 'no-mailboxes') {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="rounded-full bg-muted p-4 mb-4">
          <Mail className="size-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold mb-1">No mailboxes yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm mb-6">
          Connect your first mailbox to start sending campaigns and warming up your sending reputation.
        </p>
        {onAction && (
          <Button onClick={onAction}>Add Mailbox</Button>
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
