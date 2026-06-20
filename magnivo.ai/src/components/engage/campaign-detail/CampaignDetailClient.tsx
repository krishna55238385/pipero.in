'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Pause, Play, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { deleteEngageCampaign, runEngageWorkerNow, setCampaignStatus } from '@/app/actions/engage'
import type {
  CampaignDetailData,
  EngageSequence,
  EngageTemplate,
} from '@/types/engage'
import { STATUS_BADGE } from './shared'
import AnalyticsTab from './AnalyticsTab'
import LeadsTab from './LeadsTab'
import SequenceTab from './SequenceTab'
import ScheduleTab from './ScheduleTab'
import OptionsTab from './OptionsTab'

export default function CampaignDetailClient({
  detail,
  templates,
  sequences,
}: {
  detail: CampaignDetailData
  templates: EngageTemplate[]
  sequences: EngageSequence[]
}) {
  const router = useRouter()
  const { campaign, kpis, steps, leads, timeSeries } = detail
  const [workerRunning, setWorkerRunning] = useState(false)
  const [statusPending, setStatusPending] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const deleteCampaign = async () => {
    if (!window.confirm(`Delete campaign "${campaign.name}"? Its recipients and progress are removed too. This can't be undone.`)) return
    setDeleting(true)
    try {
      await deleteEngageCampaign(campaign.id)
      toast.success('Campaign deleted')
      router.push('/engage/campaigns')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete campaign')
      setDeleting(false)
    }
  }

  const isAuto = campaign.origin === 'auto'
  const isRunning = campaign.status === 'running'

  const runWorker = async () => {
    setWorkerRunning(true)
    try {
      const report = await runEngageWorkerNow()
      toast.success(
        `Worker finished — enrolled ${report.enrolled} · sent ${report.sent} · skipped ${report.skipped} · failed ${report.failed}`,
      )
      if (report.errors.length > 0) {
        toast.error(`${report.errors.length} worker error(s): ${report.errors[0]}`)
      }
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Worker run failed')
    } finally {
      setWorkerRunning(false)
    }
  }

  const togglePause = async () => {
    setStatusPending(true)
    try {
      const next = isRunning ? 'draft' : 'scheduled'
      await setCampaignStatus(campaign.id, next)
      toast.success(isRunning ? 'Campaign paused' : 'Campaign resumed')
      router.refresh()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'Failed to update status')
    } finally {
      setStatusPending(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-4">
        <Link
          href="/engage/campaigns"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to campaigns
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{campaign.name}</h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  isAuto
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-slate-500/10 text-slate-600 dark:text-slate-300'
                }`}
              >
                {isAuto ? 'Auto' : 'Manual'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                  STATUS_BADGE[campaign.status] ?? 'bg-muted text-muted-foreground'
                }`}
              >
                {campaign.status}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Progress value={kpis.progressPct} className="h-2 w-48" />
              <span className="text-xs tabular-nums text-muted-foreground">
                {kpis.progressPct.toFixed(0)}% complete
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={togglePause} disabled={statusPending}>
              {isRunning ? <Pause className="mr-2 h-4 w-4" /> : <Play className="mr-2 h-4 w-4" />}
              {isRunning ? 'Pause' : 'Resume'}
            </Button>
            <Button type="button" onClick={runWorker} disabled={workerRunning}>
              {workerRunning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {workerRunning ? 'Running worker…' : 'Run worker now'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={deleteCampaign}
              disabled={deleting}
              className="text-red-600 hover:bg-red-500/10 hover:text-red-600"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="analytics" className="gap-4">
        <TabsList>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="leads">Leads</TabsTrigger>
          <TabsTrigger value="sequence">Sequence</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="options">Options</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics">
          <AnalyticsTab kpis={kpis} steps={steps} timeSeries={timeSeries} />
        </TabsContent>
        <TabsContent value="leads">
          <LeadsTab leads={leads} />
        </TabsContent>
        <TabsContent value="sequence">
          <SequenceTab campaign={campaign} templates={templates} sequences={sequences} />
        </TabsContent>
        <TabsContent value="schedule">
          <ScheduleTab campaign={campaign} />
        </TabsContent>
        <TabsContent value="options">
          <OptionsTab campaign={campaign} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
