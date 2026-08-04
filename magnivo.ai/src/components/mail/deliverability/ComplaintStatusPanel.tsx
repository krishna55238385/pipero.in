'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Activity, AlertTriangle, CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getComplaintDashboard, resolveComplaintAction, dismissComplaintAction } from '@/app/actions/deliverability'
import type { ComplaintDashboardStats, ComplaintRecord } from '@/types/deliverability'

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle2 }> = {
  new: { bg: 'bg-red-500/10', text: 'text-red-600', icon: AlertTriangle },
  investigating: { bg: 'bg-amber-500/10', text: 'text-amber-600', icon: Activity },
  resolved: { bg: 'bg-emerald-500/10', text: 'text-emerald-600', icon: CheckCircle2 },
  dismissed: { bg: 'bg-muted/50', text: 'text-muted-foreground', icon: XCircle },
}

export function ComplaintStatusPanel() {
  const [stats, setStats] = useState<ComplaintDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)

  const loadStats = useCallback(async () => {
    setLoading(true)
    const s = await getComplaintDashboard()
    setStats(s)
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const handleResolve = async (id: string) => {
    await resolveComplaintAction(id)
    await loadStats()
  }

  const handleDismiss = async (id: string) => {
    await dismissComplaintAction(id)
    await loadStats()
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

  if (!stats) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Mail className="h-4 w-4" /> Complaint Monitor
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{stats.totalComplaints}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{stats.activeComplaints}</div>
            <div className="text-xs text-muted-foreground">Active</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-600">{stats.resolvedComplaints}</div>
            <div className="text-xs text-muted-foreground">Resolved</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.autoPausedMailboxes}</div>
            <div className="text-xs text-muted-foreground">Paused Mailboxes</div>
          </div>
        </div>

        {stats.recentComplaints.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Recent Complaints</h4>
            {stats.recentComplaints.map((complaint: ComplaintRecord) => {
              const style = STATUS_STYLES[complaint.status] ?? STATUS_STYLES.new
              const Icon = style.icon
              return (
                <div key={complaint.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <div className={cn('p-1.5 rounded-md', style.bg)}>
                    <Icon className={cn('h-3.5 w-3.5', style.text)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{complaint.complaintType}</span>
                      <Badge variant="secondary" className={cn('text-[10px]', style.bg, style.text)}>
                        {complaint.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Source: {complaint.source}</p>
                  </div>
                  {complaint.status === 'new' && (
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => handleResolve(complaint.id)}>
                        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDismiss(complaint.id)}>
                        <XCircle className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    </div>
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
