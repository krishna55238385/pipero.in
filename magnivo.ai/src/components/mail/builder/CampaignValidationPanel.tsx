'use client'

import { useMemo } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useCampaignBuilderStore } from '@/stores/campaign-builder'
import { getRuleMessage } from '@/lib/campaign-builder/validation'
import type { CampaignNodeValidationErrors, CampaignSeverity } from '@/types/campaign'

export default function CampaignValidationPanel() {
  const validation = useCampaignBuilderStore((s) => s.validation)
  const nodes = useCampaignBuilderStore((s) => s.nodes)
  const setSelectedNode = useCampaignBuilderStore((s) => s.setSelectedNode)

  const errorsBySeverity = useMemo(() => {
    const errors: CampaignNodeValidationErrors[] = []
    const warnings: CampaignNodeValidationErrors[] = []
    for (const e of validation.errors) {
      if (e.errors.some((er) => er.includes('missing') || er.includes('no_') || er.includes('empty'))) {
        errors.push(e)
      } else {
        warnings.push(e)
      }
    }
    return { errors, warnings }
  }, [validation.errors])

  const totalIssues = errorsBySeverity.errors.length + errorsBySeverity.warnings.length

  if (totalIssues === 0 && validation.nodeCount > 0) {
    return (
      <Card className="rounded-xl">
        <CardContent className="py-2 px-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span className="text-xs text-emerald-600 font-medium">Campaign graph is valid</span>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {validation.nodeCount} nodes, {validation.edgeCount} edges
          </span>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-xl">
      <CardHeader className="py-2 px-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold flex items-center gap-1.5">
            Validation
            <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">
              {totalIssues} issue{totalIssues !== 1 ? 's' : ''}
            </Badge>
          </CardTitle>
          <span className="text-[10px] text-muted-foreground">
            {validation.nodeCount} nodes, {validation.edgeCount} edges
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-2 space-y-1 max-h-[200px] overflow-y-auto">
        {errorsBySeverity.errors.map((err, i) => (
          <ValidationRow
            key={`e-${i}`}
            errors={err}
            severity="error"
            nodes={nodes}
            onSelectNode={setSelectedNode}
          />
        ))}
        {errorsBySeverity.warnings.map((err, i) => (
          <ValidationRow
            key={`w-${i}`}
            errors={err}
            severity="warning"
            nodes={nodes}
            onSelectNode={setSelectedNode}
          />
        ))}
      </CardContent>
    </Card>
  )
}

function ValidationRow({
  errors,
  severity,
  nodes,
  onSelectNode,
}: {
  errors: CampaignNodeValidationErrors
  severity: CampaignSeverity
  nodes: { id: string; data: { label: string } }[]
  onSelectNode: (id: string | null) => void
}) {
  const node = nodes.find((n) => n.id === errors.nodeId)
  const nodeName = node?.data?.label || errors.nodeId
  const Icon = severity === 'error' ? AlertCircle : AlertTriangle
  const color = severity === 'error' ? 'text-red-500' : 'text-amber-500'

  return (
    <button
      type="button"
      onClick={() => onSelectNode(errors.nodeId)}
      className="w-full flex items-start gap-2 py-1 px-1.5 rounded-md hover:bg-accent text-left transition-colors"
    >
      <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{nodeName}</p>
        {errors.errors.map((ruleId) => (
          <p key={ruleId} className="text-[10px] text-muted-foreground">
            {getRuleMessage(ruleId)}
          </p>
        ))}
      </div>
    </button>
  )
}
