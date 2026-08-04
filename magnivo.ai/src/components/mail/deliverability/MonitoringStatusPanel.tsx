'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Clock, Play, Pause, X, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getMonitoringJobs, getMonitoringConfigAction, updateMonitoringConfigAction, runDnsVerificationAction, cancelMonitoringJob } from '@/app/actions/deliverability'
import type { MonitoringJob, MonitoringConfig } from '@/types/deliverability'

const JOB_STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-600', icon: Clock },
  running: { bg: 'bg-blue-500/10', text: 'text-blue-600', icon: Play },
  completed: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', icon: CheckCircle2 },
  failed: { bg: 'bg-red-500/10', text: 'text-red-600', icon: XCircle },
  cancelled: { bg: 'bg-muted/50', text: 'text-muted-foreground', icon: X },
}

export function MonitoringStatusPanel() {
  const [jobs, setJobs] = useState<MonitoringJob[]>([])
  const [config, setConfig] = useState<MonitoringConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [j, c] = await Promise.all([getMonitoringJobs(10), getMonitoringConfigAction()])
    setJobs(j)
    setConfig(c)
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleRunNow = async () => {
    setRunning(true)
    await runDnsVerificationAction()
    setRunning(false)
    await loadData()
  }

  const handleCancel = async (id: string) => {
    await cancelMonitoringJob(id)
    await loadData()
  }

  const handleToggleDns = async () => {
    if (!config) return
    await updateMonitoringConfigAction({ dnsVerificationEnabled: !config.dnsVerificationEnabled })
    await loadData()
  }

  const handleToggleBlacklist = async () => {
    if (!config) return
    await updateMonitoringConfigAction({ blacklistCheckEnabled: !config.blacklistCheckEnabled })
    await loadData()
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Clock className="h-4 w-4" /> Monitoring Jobs
        </CardTitle>
        <Button size="sm" variant="outline" onClick={handleRunNow} disabled={running}>
          <Play className={cn('h-3.5 w-3.5 mr-1', running && 'animate-spin')} /> Run Now
        </Button>
      </CardHeader>
      <CardContent>
        {config && (
          <div className="flex flex-wrap gap-2 mb-4">
            <Badge
              variant={config.dnsVerificationEnabled ? 'default' : 'secondary'}
              className="cursor-pointer"
              onClick={handleToggleDns}
            >
              DNS {config.dnsVerificationEnabled ? 'ON' : 'OFF'}
            </Badge>
            <Badge
              variant={config.blacklistCheckEnabled ? 'default' : 'secondary'}
              className="cursor-pointer"
              onClick={handleToggleBlacklist}
            >
              Blacklist {config.blacklistCheckEnabled ? 'ON' : 'OFF'}
            </Badge>
            <Badge variant="secondary">
              DNS: every {config.dnsCheckIntervalHours}h
            </Badge>
            <Badge variant="secondary">
              Blacklist: every {config.blacklistCheckIntervalHours}h
            </Badge>
          </div>
        )}

        {jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No recent jobs</p>
        ) : (
          <div className="space-y-1.5">
            {jobs.map(job => {
              const style = JOB_STATUS_STYLES[job.status] ?? JOB_STATUS_STYLES.pending
              const Icon = style.icon
              return (
                <div key={job.id} className="flex items-center gap-2 p-2 rounded border text-xs">
                  <div className={cn('p-1 rounded', style.bg)}>
                    <Icon className={cn('h-3 w-3', style.text)} />
                  </div>
                  <span className="font-medium">{job.jobType}</span>
                  <Badge variant="secondary" className={cn('text-[10px]', style.bg, style.text)}>
                    {job.status}
                  </Badge>
                  {job.durationMs && (
                    <span className="text-muted-foreground">{job.durationMs}ms</span>
                  )}
                  {job.status === 'pending' && (
                    <Button size="sm" variant="ghost" className="ml-auto h-6 w-6 p-0" onClick={() => handleCancel(job.id)}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
