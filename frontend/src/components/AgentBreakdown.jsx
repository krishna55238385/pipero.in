import { useState, useEffect, useMemo } from 'react'
import { fetchByAgent } from '../api'
import { AGENT_LABELS } from './AgentBarChart'
import EmptyState from './EmptyState'

const PHASE_ORDER = ['phase1', 'phase2', 'phase3', 'crm', 'unknown']

const PHASE_PILL_STYLES = {
  phase1: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  phase2: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  phase3: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  crm: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
}

function prettifyAgent(name) {
  if (!name) return 'Unknown'
  return AGENT_LABELS[name] ?? name
}

function prettifyPhaseLabel(phase) {
  if (!phase) return 'UNKNOWN'
  const m = String(phase).match(/^phase[_-]?(\d+)$/i)
  if (m) return `PHASE ${parseInt(m[1], 10)}`
  return String(phase).toUpperCase()
}

function formatTokens(val) {
  return (val ?? 0).toLocaleString()
}

function formatCost(val) {
  const num = val ?? 0
  // 4-6 decimals: keep 4 when >= $1, otherwise 6 for visibility of small values.
  const decimals = num >= 1 ? 4 : 6
  return `$${num.toFixed(decimals)}`
}

function formatRelativeTime(iso) {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffMs = Date.now() - then
  if (diffMs < 0) return 'just now'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(months / 12)
  return `${years}y ago`
}

function normalizePhase(phase) {
  if (!phase) return 'unknown'
  const lower = String(phase).toLowerCase()
  return PHASE_ORDER.includes(lower) ? lower : (lower.startsWith('phase') ? lower : 'unknown')
}

function SkeletonRow() {
  return (
    <tr>
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 rounded bg-slate-200 dark:bg-slate-800 animate-pulse"
            style={{ width: `${50 + i * 8}%` }}
          />
        </td>
      ))}
    </tr>
  )
}

const SORT_COLUMNS = {
  agent: (r) => prettifyAgent(r.agent).toLowerCase(),
  models: (r) => (r.models?.[0] ?? '').toLowerCase(),
  calls: (r) => r.calls ?? 0,
  total_tokens: (r) => r.total_tokens ?? 0,
  cost_usd: (r) => r.cost_usd ?? 0,
  last_used_at: (r) => (r.last_used_at ? new Date(r.last_used_at).getTime() : 0),
}

function SortableHeader({ label, columnKey, sortBy, sortDir, onSort, align = 'left' }) {
  const active = sortBy === columnKey
  const alignCls = align === 'right' ? 'text-right' : 'text-left'
  return (
    <th
      className={`${alignCls} text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-4 py-3 select-none`}
    >
      <button
        onClick={() => onSort(columnKey)}
        className={`inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors ${
          active ? 'text-indigo-600 dark:text-indigo-300' : ''
        }`}
      >
        {label}
        <span className="text-[10px] leading-none">
          {active ? (sortDir === 'desc' ? '↓' : '↑') : '↕'}
        </span>
      </button>
    </th>
  )
}

export default function AgentBreakdown() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortBy, setSortBy] = useState('cost_usd')
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchByAgent()
      .then(res => {
        const data = Array.isArray(res) ? res : (res?.data ?? res?.agents ?? [])
        setRows(data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  function handleSort(col) {
    if (sortBy === col) {
      setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(col)
      setSortDir(col === 'agent' || col === 'models' ? 'asc' : 'desc')
    }
  }

  const grouped = useMemo(() => {
    const buckets = {}
    for (const r of rows) {
      const key = normalizePhase(r.phase)
      if (!buckets[key]) buckets[key] = []
      buckets[key].push(r)
    }
    const accessor = SORT_COLUMNS[sortBy] ?? SORT_COLUMNS.cost_usd
    for (const key of Object.keys(buckets)) {
      buckets[key].sort((a, b) => {
        const va = accessor(a)
        const vb = accessor(b)
        if (va < vb) return sortDir === 'desc' ? 1 : -1
        if (va > vb) return sortDir === 'desc' ? -1 : 1
        return 0
      })
    }
    const orderedKeys = [
      ...PHASE_ORDER.filter(k => buckets[k]?.length),
      ...Object.keys(buckets).filter(k => !PHASE_ORDER.includes(k)),
    ]
    return orderedKeys.map(key => {
      const items = buckets[key]
      const totalCost = items.reduce((s, r) => s + (r.cost_usd ?? 0), 0)
      const totalCalls = items.reduce((s, r) => s + (r.calls ?? 0), 0)
      return { phase: key, items, totalCost, totalCalls }
    })
  }, [rows, sortBy, sortDir])

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-slate-900 dark:text-slate-100 font-semibold text-base">
            Agent Breakdown
          </h2>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">
            Per-agent activity grouped by pipeline phase
          </p>
        </div>
        {!loading && !error && rows.length > 0 && (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {rows.length} {rows.length === 1 ? 'agent' : 'agents'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
              {[...Array(5)].map((_, i) => <SkeletonRow key={i} />)}
            </tbody>
          </table>
        </div>
      ) : error ? (
        <div className="px-4 py-8 border border-red-100 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 rounded-lg text-sm text-red-700 dark:text-red-300">
          Failed to load agent breakdown: {error}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          icon="🤖"
          message="No agent activity yet"
          hint="Agent rows will appear once any agent runs"
          className="h-48"
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(group => (
            <div key={group.phase}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full tracking-wide ${
                      PHASE_PILL_STYLES[group.phase] ?? PHASE_PILL_STYLES.unknown
                    }`}
                  >
                    {prettifyPhaseLabel(group.phase)}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    {group.items.length} {group.items.length === 1 ? 'agent' : 'agents'}
                    {' · '}
                    ${group.totalCost.toFixed(4)}
                    {' · '}
                    {group.totalCalls.toLocaleString()} {group.totalCalls === 1 ? 'call' : 'calls'}
                  </span>
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-100 dark:border-slate-800 rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/50">
                      <SortableHeader
                        label="Agent"
                        columnKey="agent"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Models"
                        columnKey="models"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortableHeader
                        label="Calls"
                        columnKey="calls"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableHeader
                        label="Total tokens"
                        columnKey="total_tokens"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableHeader
                        label="Cost USD"
                        columnKey="cost_usd"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                      <SortableHeader
                        label="Last used"
                        columnKey="last_used_at"
                        sortBy={sortBy}
                        sortDir={sortDir}
                        onSort={handleSort}
                        align="right"
                      />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                    {group.items.map((row, i) => (
                      <tr
                        key={row.agent ?? i}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-800 dark:text-slate-100">
                            {prettifyAgent(row.agent)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.models?.length ? (
                            <div className="flex flex-wrap gap-1">
                              {row.models.map(m => (
                                <span
                                  key={m}
                                  className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                                >
                                  {m}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          {formatTokens(row.calls)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                          {formatTokens(row.total_tokens)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-slate-100">
                          {formatCost(row.cost_usd)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-500 dark:text-slate-400 text-xs">
                          {formatRelativeTime(row.last_used_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
