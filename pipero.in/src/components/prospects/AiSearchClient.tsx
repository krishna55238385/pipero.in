'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Sparkles, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { RunPhaseButton } from '@/components/prospects/run-phase-button'
import { PipelineRunsPanel } from '@/components/prospects/PipelineRunsPanel'
import { runPhase1Search } from '@/app/actions/gtm'
import type { PhaseRun } from '@/types/gtm'

const STAGES = [
  'Defines an ICP',
  'Finds companies',
  'Enriches contacts & emails',
  'Detects buying signals',
  'Scores everything',
]

export function AiSearchClient({ runs }: { runs: PhaseRun[] }) {
  const [prompt, setPrompt] = useState('')
  const trimmed = prompt.trim()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI Prospect Search</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Describe the companies you want to find. AI matches your criteria to prospects.
        </p>
      </div>

      <Card className="rounded-xl border bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Describe your ideal customer
          </CardTitle>
          <CardDescription>
            One prompt runs the whole pipeline: it defines an ICP, finds companies, enriches contacts &amp;
            emails, detects buying signals and scores everything — all stored automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="e.g. Series A–C fintech companies in India using outdated billing software, target the VP Finance or Head of Payments"
            className="text-base"
          />

          <div className="flex flex-wrap items-center gap-2">
            {STAGES.map((stage, i) => (
              <span key={stage} className="flex items-center gap-2">
                <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                  {stage}
                </Badge>
                {i < STAGES.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <RunPhaseButton
              run={() => runPhase1Search(trimmed)}
              label="Search & store"
              runningLabel="Running pipeline…"
              icon={<Zap className="h-4 w-4" />}
              className={trimmed ? undefined : 'pointer-events-none opacity-50'}
            />
            <Button asChild variant="ghost" size="sm" className="gap-1.5">
              <Link href="/prospects/leads">
                View prospect leads
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <span className="text-xs text-muted-foreground">
              Watch live status &amp; logs below; results appear in the leads list when the run finishes.
            </span>
          </div>
        </CardContent>
      </Card>

      <PipelineRunsPanel
        initialRuns={runs}
        description="Live status, errors and full console logs for the latest search &amp; pipeline jobs."
      />
    </div>
  )
}
