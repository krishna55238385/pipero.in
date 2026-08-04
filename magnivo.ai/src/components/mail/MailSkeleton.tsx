import { cn } from '@/lib/utils'

type MailSkeletonProps = {
  className?: string
  lines?: number
  type?: 'card' | 'list' | 'table' | 'stat'
}

function SkeletonPulse({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-md bg-muted animate-pulse',
        className
      )}
    />
  )
}

export function MailSkeleton({ className, type = 'card' }: MailSkeletonProps) {
  if (type === 'stat') {
    return (
      <div className={cn('space-y-2 p-4 rounded-xl border border-border/40 bg-card', className)}>
        <SkeletonPulse className="h-3 w-20" />
        <SkeletonPulse className="h-7 w-16" />
        <SkeletonPulse className="h-3 w-24" />
      </div>
    )
  }

  if (type === 'list') {
    return (
      <div className={cn('space-y-2', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border/30">
            <SkeletonPulse className="h-8 w-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <SkeletonPulse className="h-3.5 w-32" />
              <SkeletonPulse className="h-3 w-48" />
            </div>
            <SkeletonPulse className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (type === 'table') {
    return (
      <div className={cn('space-y-0 rounded-xl border border-border/40 overflow-hidden', className)}>
        <div className="flex items-center gap-4 p-4 bg-muted/50 border-b border-border/30">
          <SkeletonPulse className="h-4 w-24" />
          <SkeletonPulse className="h-4 w-32" />
          <SkeletonPulse className="h-4 w-20" />
          <SkeletonPulse className="h-4 w-16" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 border-b border-border/20 last:border-0">
            <SkeletonPulse className="h-3.5 w-24" />
            <SkeletonPulse className="h-3.5 w-32" />
            <SkeletonPulse className="h-5 w-16 rounded-full" />
            <SkeletonPulse className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className={cn('space-y-3 p-6 rounded-xl border border-border/40 bg-card', className)}>
      <SkeletonPulse className="h-5 w-40" />
      <SkeletonPulse className="h-3 w-full" />
      <SkeletonPulse className="h-3 w-3/4" />
      <div className="flex gap-2 pt-2">
        <SkeletonPulse className="h-8 w-20 rounded-lg" />
        <SkeletonPulse className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  )
}

export function MailStatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <MailSkeleton key={i} type="stat" />
      ))}
    </div>
  )
}

export function MailTableSkeleton() {
  return <MailSkeleton type="table" />
}

export function MailListSkeleton() {
  return <MailSkeleton type="list" />
}
