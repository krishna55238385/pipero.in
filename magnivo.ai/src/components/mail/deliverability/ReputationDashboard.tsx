'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, TrendingDown, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getReputationDashboard, getDomainReputationHistoryAction, getMailboxReputationsAction } from '@/app/actions/deliverability'
import type { ReputationDashboardStats, DomainReputation, ReputationTrend, MailboxReputation } from '@/types/deliverability'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts'

const LEVEL_STYLES: Record<string, { bg: string; text: string }> = {
  excellent: { bg: 'bg-emerald-500/10', text: 'text-emerald-600' },
  good: { bg: 'bg-blue-500/10', text: 'text-blue-600' },
  fair: { bg: 'bg-amber-500/10', text: 'text-amber-600' },
  poor: { bg: 'bg-red-500/10', text: 'text-red-600' },
  unknown: { bg: 'bg-muted/50', text: 'text-muted-foreground' },
}

export function ReputationDashboard() {
  const [stats, setStats] = useState<ReputationDashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedDomainId, setSelectedDomainId] = useState<string | null>(null)
  const [historyData, setHistoryData] = useState<ReputationTrend[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const loadStats = useCallback(async () => {
    setLoading(true)
    const s = await getReputationDashboard()
    setStats(s)
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const loadHistory = useCallback(async (domainId: string) => {
    setLoadingHistory(true)
    setSelectedDomainId(domainId)
    const history = await getDomainReputationHistoryAction(domainId)
    const trendData = history.map((h: DomainReputation) => ({
      date: new Date(h.recordedAt).toLocaleDateString(),
      score: h.reputationScore,
      level: h.reputationLevel,
    })).reverse()
    setHistoryData(trendData)
    setLoadingHistory(false)
  }, [])

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
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" /> Reputation Overview
        </CardTitle>
        <Button size="sm" variant="ghost" onClick={loadStats}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="text-center">
            <div className="text-2xl font-bold">{stats.domainsTracked}</div>
            <div className="text-xs text-muted-foreground">Tracked</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.avgReputationScore}</div>
            <div className="text-xs text-muted-foreground">Avg Score</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-emerald-600">{stats.improvingDomains}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <TrendingUp className="h-3 w-3" /> Improving
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">{stats.decliningDomains}</div>
            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <TrendingDown className="h-3 w-3" /> Declining
            </div>
          </div>
        </div>

        {historyData.length > 0 && (
          <div className="mb-4">
            <h4 className="text-xs font-medium text-muted-foreground mb-2">
              Reputation History
            </h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={historyData}>
                  <defs>
                    <linearGradient id="repGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    className="text-xs"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    className="text-xs"
                    tick={{ fontSize: 10 }}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="#3b82f6"
                    fillOpacity={1}
                    fill="url(#repGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {stats.recentEntries.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Domain Reputation</h4>
            {stats.recentEntries.map((entry: DomainReputation) => {
              const style = LEVEL_STYLES[entry.reputationLevel] ?? LEVEL_STYLES.unknown
              const isSelected = selectedDomainId === entry.domainId
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => loadHistory(entry.domainId)}
                  className={cn(
                    'w-full flex items-center gap-3 p-2 rounded-lg border transition-colors text-left',
                    isSelected ? 'bg-muted/30 border-primary/30' : 'hover:bg-muted/20'
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium">{entry.domainId.slice(0, 8)}...</span>
                    <span className="text-xs text-muted-foreground ml-2">{entry.source}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-lg font-bold', style.text)}>{entry.reputationScore}</span>
                    <Badge variant="secondary" className={cn('text-[10px]', style.bg, style.text)}>
                      {entry.reputationLevel}
                    </Badge>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        <MailboxReputationPanel />

        {loadingHistory && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MailboxReputationPanel() {
  const [rows, setRows] = useState<MailboxReputation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void getMailboxReputationsAction()
      .then(setRows)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="mt-4 flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        No mailbox reputation scores yet. Scores appear after Postmaster/SNDS sync or internal calculation.
      </p>
    )
  }

  return (
    <div className="mt-4 space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">Mailbox Reputation</h4>
      {rows.slice(0, 20).map((entry) => {
        const style = LEVEL_STYLES[entry.reputationLevel] ?? LEVEL_STYLES.unknown
        return (
          <div
            key={entry.id}
            className="flex items-center gap-3 p-2 rounded-lg border"
          >
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium truncate block">{entry.mailboxId.slice(0, 8)}…</span>
              <span className="text-xs text-muted-foreground">{entry.source}</span>
            </div>
            <span className={cn('text-lg font-bold', style.text)}>{entry.reputationScore}</span>
            <Badge variant="secondary" className={cn('text-[10px]', style.bg, style.text)}>
              {entry.reputationLevel}
            </Badge>
          </div>
        )
      })}
    </div>
  )
}
