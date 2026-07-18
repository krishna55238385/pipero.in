'use client'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sparkles, ArrowRight, Zap } from 'lucide-react'
import Link from 'next/link'

type PaywallBannerProps = {
  title?: string
  description?: string
  feature?: string
  compact?: boolean
}

export function PaywallBanner({
  title = 'Unlock the full power of Magnivo AI',
  description = 'Upgrade your plan to access advanced features, increase limits, and supercharge your sales workflow.',
  feature,
  compact = false,
}: PaywallBannerProps) {
  if (compact) {
    return (
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-primary/3 to-transparent overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {feature ? `${feature} is a premium feature` : title}
              </p>
              <p className="text-xs text-muted-foreground truncate">{description}</p>
            </div>
          </div>
          <Link href="/settings" className="shrink-0">
            <Button size="sm" className="gap-1.5">
              Upgrade
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </Card>
    )
  }

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-primary/3 to-transparent overflow-hidden">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-6 py-5">
        <div className="flex items-start gap-4 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-md">{description}</p>
          </div>
        </div>
        <Link href="/settings" className="shrink-0">
          <Button className="gap-1.5">
            View Plans
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </div>
    </Card>
  )
}
