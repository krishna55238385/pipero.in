'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Copy, Check, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProviderDnsInstruction, DnsProvider } from '@/types/deliverability'

type ProviderInstructionsPanelProps = {
  instructions: ProviderDnsInstruction[]
  providers: { id: DnsProvider; name: string }[]
  selectedProvider: DnsProvider
  onProviderChange: (provider: DnsProvider) => void
  domain: string
  recordType: 'spf' | 'dkim' | 'dmarc' | 'tracking' | 'return_path'
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2"
      onClick={handleCopy}
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-500" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      <span className="ml-1 text-xs">{copied ? 'Copied' : 'Copy'}</span>
    </Button>
  )
}

function InstructionStep({ step, index }: { step: string; index: number }) {
  return (
    <div className="flex gap-2 py-1">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium flex items-center justify-center">
        {index + 1}
      </span>
      <span className="text-sm text-muted-foreground">{step}</span>
    </div>
  )
}

export function ProviderInstructionsPanel({
  instructions,
  providers,
  selectedProvider,
  onProviderChange,
  domain,
  recordType,
}: ProviderInstructionsPanelProps) {
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const instruction = instructions[0]

  if (!instruction) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">DNS Setup Instructions</CardTitle>
          <select
            value={selectedProvider}
            onChange={(e) => onProviderChange(e.target.value as DnsProvider)}
            className="text-xs border rounded-md px-2 py-1 bg-background"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Record Type</span>
            <span className="text-xs font-mono bg-background px-2 py-0.5 rounded">{instruction.recordType}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Host / Name</span>
            <div className="flex items-center gap-1">
              <code className="text-xs font-mono bg-background px-2 py-0.5 rounded">{instruction.host}</code>
              <CopyButton text={instruction.host} />
            </div>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground shrink-0">Value</span>
            <div className="flex items-start gap-1 min-w-0">
              <code className="text-xs font-mono bg-background px-2 py-0.5 rounded break-all min-w-0">{instruction.value}</code>
              <CopyButton text={instruction.value} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">TTL</span>
            <span className="text-xs font-mono bg-background px-2 py-0.5 rounded">{instruction.ttl}s</span>
          </div>
        </div>

        {instruction.notes && (
          <p className="text-xs text-muted-foreground bg-muted/20 p-2 rounded-md">{instruction.notes}</p>
        )}

        <div>
          <button
            type="button"
            onClick={() => setExpandedStep(expandedStep === 0 ? null : 0)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
          >
            {expandedStep === 0 ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Step-by-step guide for {instruction.providerName}
          </button>
          {expandedStep === 0 && (
            <div className="mt-2 pl-1 space-y-0.5">
              {instruction.steps.map((step, i) => (
                <InstructionStep key={i} step={step} index={i} />
              ))}
            </div>
          )}
        </div>

        <div className="pt-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => window.open(`https://dns.google/lookup?q=${instruction.host}`, '_blank')}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Check on Google DNS
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
