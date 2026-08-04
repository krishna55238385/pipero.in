'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { WarmupConfigResponse } from '@/types/mail'

type WarmupCalendarProps = {
  configs: WarmupConfigResponse[]
  onSelect: (id: string) => void
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return d
}

function startOfWeek(d: Date): Date {
  const x = new Date(d)
  const day = x.getDay()
  x.setDate(x.getDate() - day)
  x.setHours(0, 0, 0, 0)
  return x
}

export function WarmupCalendar({ configs, onSelect }: WarmupCalendarProps) {
  const weekStart = useMemo(() => startOfWeek(new Date()), [])
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const eventsByDay = useMemo(() => {
    const map = new Map<string, WarmupConfigResponse[]>()
    for (const day of days) {
      map.set(day.toISOString().slice(0, 10), [])
    }
    for (const cfg of configs) {
      if (!cfg.startDate) continue
      const start = new Date(cfg.startDate)
      for (let i = 0; i < cfg.totalDays; i++) {
        const day = addDays(start, i)
        if (cfg.weekendSending === false && (day.getDay() === 0 || day.getDay() === 6)) continue
        const key = day.toISOString().slice(0, 10)
        if (!map.has(key)) continue
        map.get(key)!.push(cfg)
      }
    }
    return map
  }, [configs, days])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Warmup calendar (14 days)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-2">
          {days.map((day) => {
            const key = day.toISOString().slice(0, 10)
            const items = eventsByDay.get(key) || []
            const isToday = key === new Date().toISOString().slice(0, 10)
            return (
              <div
                key={key}
                className={`min-h-[110px] rounded-md border p-2 ${isToday ? 'border-primary bg-primary/5' : ''}`}
              >
                <p className="text-[11px] text-muted-foreground mb-1">
                  {day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </p>
                <div className="space-y-1">
                  {items.slice(0, 3).map((cfg) => (
                    <button
                      key={`${key}-${cfg.id}`}
                      type="button"
                      className="w-full text-left text-[10px] truncate rounded px-1 py-0.5 bg-muted hover:bg-muted/80"
                      onClick={() => onSelect(cfg.id)}
                    >
                      {cfg.mailboxEmail.split('@')[0]} · d{Math.min(cfg.currentDay, cfg.totalDays)}/{cfg.totalDays}
                    </button>
                  ))}
                  {items.length > 3 && (
                    <p className="text-[10px] text-muted-foreground">+{items.length - 3} more</p>
                  )}
                  {items.length === 0 && <p className="text-[10px] text-muted-foreground/60">—</p>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          {(['running', 'paused', 'graduated'] as const).map((s) => (
            <Badge key={s} variant="outline" className="capitalize">
              {s}: {configs.filter((c) => c.status === s).length}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
