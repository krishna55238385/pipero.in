'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Stethoscope, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import type { DeliverabilityDomain } from '@/types/deliverability'
import { DnsPropagationGuidance } from './DnsPropagationGuidance'

type CheckRow = {
  id: string
  label: string
  status: string
  severity: 'ok' | 'warn' | 'fail' | 'skip'
  guidance: string
}

function statusSeverity(status: string): CheckRow['severity'] {
  const s = (status || '').toLowerCase()
  if (s === 'valid' || s === 'verified' || s === 'pass') return 'ok'
  if (s === 'warning' || s === 'at_risk' || s === 'pending' || s === 'unverified' || s === 'not_configured')
    return 'warn'
  if (s === 'invalid' || s === 'failed' || s === 'error' || s === 'missing') return 'fail'
  return 'skip'
}

/**
 * Full DNS diagnostic center for a single domain (PRD §6.2.18 / §6.2.20).
 */
export function DnsDiagnosticsCenter({
  domain,
  onRecheck,
  busy,
}: {
  domain: DeliverabilityDomain
  onRecheck?: () => void
  busy?: boolean
}) {
  const checks = useMemo<CheckRow[]>(() => {
    const rows: CheckRow[] = [
      {
        id: 'spf',
        label: 'SPF',
        status: domain.spfStatus,
        severity: statusSeverity(domain.spfStatus),
        guidance: 'TXT at root should include Magnivo/include mechanisms and end with ~all or -all.',
      },
      {
        id: 'dkim',
        label: 'DKIM',
        status: domain.dkimStatus,
        severity: statusSeverity(domain.dkimStatus),
        guidance: 'Publish selector CNAME/TXT from Selector Manager; rotate without deleting prior selector.',
      },
      {
        id: 'dmarc',
        label: 'DMARC',
        status: domain.dmarcStatus,
        severity: statusSeverity(domain.dmarcStatus),
        guidance: 'Start with p=none; move to quarantine/reject after SPF+DKIM align.',
      },
      {
        id: 'mx',
        label: 'MX',
        status: domain.mxStatus,
        severity: statusSeverity(domain.mxStatus),
        guidance: 'MX must resolve for receiving/bounce handling. Missing MX blocks inbox read tests.',
      },
      {
        id: 'tracking',
        label: 'Tracking',
        status: domain.trackingStatus,
        severity: statusSeverity(domain.trackingStatus),
        guidance: 'CNAME tracking subdomain to Magnivo tracking target; must be unique per workspace.',
      },
      {
        id: 'bimi',
        label: 'BIMI',
        status: domain.bimiStatus,
        severity: statusSeverity(domain.bimiStatus === 'not_configured' ? 'unverified' : domain.bimiStatus),
        guidance: 'Optional: TXT at default._bimi + SVG logo once DMARC is enforced.',
      },
    ]
    return rows
  }, [domain])

  const failed = checks.filter((c) => c.severity === 'fail').map((c) => c.label)
  const warnings = checks.filter((c) => c.severity === 'warn').map((c) => c.label)
  const hasIssues = failed.length > 0 || warnings.length > 0

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            DNS Diagnostics — {domain.domain}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {checks.map((c) => (
            <div
              key={c.id}
              className="flex items-start gap-3 rounded-md border px-3 py-2"
              role="listitem"
            >
              {c.severity === 'ok' ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
              ) : c.severity === 'fail' ? (
                <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{c.label}</span>
                  <Badge
                    variant="outline"
                    className={
                      c.severity === 'ok'
                        ? 'border-emerald-500/40 text-emerald-700'
                        : c.severity === 'fail'
                          ? 'border-destructive/40 text-destructive'
                          : 'border-amber-500/40 text-amber-700'
                    }
                  >
                    {c.status || 'unknown'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{c.guidance}</p>
              </div>
            </div>
          ))}
          {warnings.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 pt-1">
              Warnings (non-blocking): {warnings.join(', ')}. Fix before scaling send volume.
            </p>
          )}
        </CardContent>
      </Card>

      {hasIssues && (
        <DnsPropagationGuidance
          lastCheckedAt={domain.lastCheckedAt}
          onRecheck={onRecheck}
          busy={busy}
          failedRecords={[...failed, ...warnings]}
        />
      )}
    </div>
  )
}
