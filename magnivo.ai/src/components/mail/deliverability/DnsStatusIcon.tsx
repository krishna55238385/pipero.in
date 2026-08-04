'use client'

import { CheckCircle2, XCircle, AlertCircle, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DnsRecordStatus } from '@/types/deliverability'

type StatusIconProps = {
  status: DnsRecordStatus
  className?: string
  size?: number
}

const STATUS_CONFIG: Record<DnsRecordStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  valid: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Valid' },
  invalid: { icon: XCircle, color: 'text-red-500', label: 'Invalid' },
  missing: { icon: AlertCircle, color: 'text-amber-500', label: 'Missing' },
  unverified: { icon: HelpCircle, color: 'text-muted-foreground', label: 'Not verified' },
}

export function DnsStatusIcon({ status, className, size = 16 }: StatusIconProps) {
  const config = STATUS_CONFIG[status]
  const Icon = config.icon
  return <Icon className={cn(config.color, className)} size={size} />
}

export function DnsStatusLabel({ status, className }: { status: DnsRecordStatus; className?: string }) {
  const config = STATUS_CONFIG[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', className)}>
      <DnsStatusIcon status={status} size={14} />
      {config.label}
    </span>
  )
}
