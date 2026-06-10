"use client"

import { useMemo, useState } from "react"
import { ArrowUpDown, FileDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { CallLog } from "@/components/dialer/storage"

type SortKey = "date" | "duration" | "outcome"
type SortDir = "asc" | "desc"

type Props = {
  rows: CallLog[]
  onRowClick: (row: CallLog) => void
  enableBulk?: boolean
}

function fmtTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60).toString().padStart(2, "0")
  const secs = (totalSeconds % 60).toString().padStart(2, "0")
  return `${mins}:${secs}`
}

function outcomeBadgeClass(outcome: CallLog["outcome"]) {
  if (outcome === "connected") return "border-emerald-500/30 text-emerald-600 bg-emerald-500/10"
  if (outcome === "voicemail") return "border-amber-500/30 text-amber-600 bg-amber-500/10"
  if (outcome === "failed") return "border-rose-500/30 text-rose-600 bg-rose-500/10"
  return ""
}

export default function CallHistoryTable({ rows, onRowClick, enableBulk }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const sign = sortDir === "asc" ? 1 : -1
      if (sortKey === "date") return sign * (new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
      if (sortKey === "duration") return sign * ((a.durationSeconds || 0) - (b.durationSeconds || 0))
      return sign * String(a.outcome).localeCompare(String(b.outcome))
    })
    return copy
  }, [rows, sortKey, sortDir])

  const selectedRows = useMemo(() => sorted.filter((r) => selected[r.id]), [sorted, selected])

  const toggleSort = (k: SortKey) => {
    if (sortKey !== k) {
      setSortKey(k)
      setSortDir("desc")
      return
    }
    setSortDir((d) => (d === "desc" ? "asc" : "desc"))
  }

  const exportCsv = (data: CallLog[]) => {
    const header =
      "lead,company,phone,direction,outcome,started_at,duration_seconds,has_recording,has_transcript,has_summary,tags"
    const rows = data.map((l) =>
      [
        l.leadName,
        l.company,
        l.phone,
        l.direction,
        l.outcome,
        l.startedAt,
        l.durationSeconds,
        l.hasRecording,
        Boolean(l.transcript?.trim()),
        Boolean(l.summary),
        (l.tags ?? []).join("|"),
      ]
        .map((x) => `"${String(x).replaceAll('"', '""')}"`)
        .join(",")
    )
    const csv = [header, ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `dialer-calls-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {rows.length} calls{enableBulk ? ` · ${selectedRows.length} selected` : ""}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => exportCsv(enableBulk && selectedRows.length ? selectedRows : sorted)}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 sticky top-0 z-10">
              <tr className="text-xs text-muted-foreground">
                {enableBulk ? (
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={sorted.length > 0 && selectedRows.length === sorted.length}
                      onChange={(e) => {
                        const checked = e.target.checked
                        const next: Record<string, boolean> = {}
                        if (checked) sorted.forEach((r) => (next[r.id] = true))
                        setSelected(next)
                      }}
                    />
                  </th>
                ) : null}
                <th className="px-3 py-2 text-left">Lead</th>
                <th className="px-3 py-2 text-left">Company</th>
                <th className="px-3 py-2 text-left">Outcome</th>
                <th className="px-3 py-2 text-left">
                  <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("duration")}>
                    Duration <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">
                  <button type="button" className="inline-flex items-center gap-1" onClick={() => toggleSort("date")}>
                    Date <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-2 text-left">Signals</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  className="border-t hover:bg-accent/40 cursor-pointer"
                  onClick={() => onRowClick(r)}
                >
                  {enableBulk ? (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[r.id])}
                        onChange={(e) => setSelected((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                      />
                    </td>
                  ) : null}
                  <td className="px-3 py-2">
                    <div className="font-medium truncate max-w-[220px]">{r.leadName}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[220px]">{r.phone}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="truncate max-w-[220px]">{r.company}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={outcomeBadgeClass(r.outcome)}>
                      {r.outcome}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{fmtTime(r.durationSeconds)}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {r.hasRecording ? <Badge variant="outline">Recording</Badge> : null}
                      {r.transcript?.trim() ? <Badge variant="outline">Transcript</Badge> : null}
                      {r.summary ? <Badge variant="outline">Summary</Badge> : null}
                      {(r.tags ?? []).slice(0, 2).map((t) => (
                        <Badge key={t} variant="outline">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {!sorted.length ? (
                <tr>
                  <td className="px-3 py-8 text-center text-sm text-muted-foreground" colSpan={enableBulk ? 7 : 6}>
                    No calls match the current filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

