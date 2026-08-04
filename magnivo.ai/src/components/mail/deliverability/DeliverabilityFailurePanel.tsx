'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  AlertCircle,
  Shield,
  Key,
  FileText,
  Link2,
  RotateCcw,
  Clock,
  Wifi,
  RefreshCw,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  getDeliverabilityDomains,
  getDomainFailures,
} from '@/app/actions/deliverability'
import type { DeliverabilityDomain } from '@/types/deliverability'

type DomainFailure = {
  domain: DeliverabilityDomain
  failures: string[]
  warnings: string[]
}

const FAILURE_ICONS: Record<string, typeof Shield> = {
  spf: Shield,
  dkim: Key,
  dmarc: FileText,
  tracking: Link2,
  return_path: RotateCcw,
}

export function DeliverabilityFailurePanel() {
  const [domains, setDomains] = useState<DeliverabilityDomain[]>([])
  const [domainFailures, setDomainFailures] = useState<DomainFailure[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const allDomains = await getDeliverabilityDomains()
      setDomains(allDomains)

      const failureResults: DomainFailure[] = []
      for (const domain of allDomains) {
        const { failures, warnings } = await getDomainFailures(domain.id)
        if (failures.length > 0 || warnings.length > 0) {
          failureResults.push({ domain, failures, warnings })
        }
      }
      setDomainFailures(failureResults)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const criticalCount = domainFailures.reduce((acc, d) => acc + d.failures.length, 0)
  const warningCount = domainFailures.reduce((acc, d) => acc + d.warnings.length, 0)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Issues & Warnings</CardTitle>
            {criticalCount > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 bg-red-500/10 text-red-600 border-red-500/20">
                {criticalCount} critical
              </Badge>
            )}
            {warningCount > 0 && (
              <Badge className="text-[10px] px-1.5 py-0 bg-amber-500/10 text-amber-600 border-amber-500/20">
                {warningCount} warnings
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={loadData}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading ? (
          <div className="text-center py-6 text-xs text-muted-foreground">Scanning domains...</div>
        ) : domainFailures.length === 0 ? (
          <div className="text-center py-6">
            <Shield className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-xs text-emerald-600 font-medium">All domains healthy</p>
            <p className="text-xs text-muted-foreground">No issues detected</p>
          </div>
        ) : (
          domainFailures.map(({ domain, failures, warnings }) => (
            <div key={domain.id} className="border rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedDomain(expandedDomain === domain.id ? null : domain.id)}
                className="w-full flex items-center justify-between p-2.5 hover:bg-muted/30 transition-colors text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {expandedDomain === domain.id ? (
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  ) : (
                    <ChevronRight className="h-3 w-3 shrink-0" />
                  )}
                  <span className="text-sm font-medium truncate">{domain.domain}</span>
                  {failures.length > 0 && (
                    <Badge className="text-[10px] px-1 py-0 bg-red-500/10 text-red-600">
                      {failures.length}
                    </Badge>
                  )}
                  {warnings.length > 0 && (
                    <Badge className="text-[10px] px-1 py-0 bg-amber-500/10 text-amber-600">
                      {warnings.length}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {domain.healthScore}%
                </span>
              </button>
              {expandedDomain === domain.id && (
                <div className="px-2.5 pb-2.5 space-y-1.5 border-t">
                  {failures.map((failure, i) => (
                    <div key={`f-${i}`} className="flex items-start gap-2 py-1.5 text-xs">
                      <AlertCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                      <span className="text-red-600">{failure}</span>
                    </div>
                  ))}
                  {warnings.map((warning, i) => (
                    <div key={`w-${i}`} className="flex items-start gap-2 py-1.5 text-xs">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <span className="text-amber-600">{warning}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
