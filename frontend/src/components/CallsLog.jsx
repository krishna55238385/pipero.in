import { useState, useEffect, useCallback } from 'react'
import { fetchCalls } from '../api'
import EmptyState from './EmptyState'

const PAGE_SIZE = 20

const AGENT_OPTIONS = [
  { value: '', label: 'All Agents' },
  // Phase 1 — FIND
  { value: 'agent_01_icp', label: 'Agent 01 — ICP Definition' },
  { value: 'agent_02_leads', label: 'Agent 02 — Lead Generation' },
  { value: 'agent_03_enrichment', label: 'Agent 03 — Enrichment' },
  { value: 'agent_04_signals', label: 'Agent 04 — Buying Signals' },
  { value: 'agent_05_scoring', label: 'Agent 05 — ICP Scoring' },
  // Phase 2 — UNDERSTAND
  { value: 'agent_06_account_intel', label: 'Agent 06 — Account Intelligence' },
  { value: 'agent_07_stakeholders', label: 'Agent 07 — Stakeholder Mapping' },
  { value: 'agent_08_competitive', label: 'Agent 08 — Competitive Intel' },
  { value: 'agent_09_market_sizing', label: 'Agent 09 — Market Sizing' },
  { value: 'agent_10_gtm_insights', label: 'Agent 10 — GTM Insights' },
  // Phase 3 — REACH
  { value: 'agent_11_personalisation', label: 'Agent 11 — Personalisation' },
  { value: 'agent_12_copywriter', label: 'Agent 12 — Copywriter' },
  { value: 'agent_13_channel_strategy', label: 'Agent 13 — Channel Strategy' },
  { value: 'agent_14_orchestrator', label: 'Agent 14 — Omnichannel Orchestrator' },
  { value: 'agent_15_ab_testing', label: 'Agent 15 — A/B Testing' },
  // CRM
  { value: 'engage_email_ai', label: 'CRM — Email AI' },
  { value: 'engage_compose_ai', label: 'CRM — Compose AI' },
  { value: 'engage_template_ai', label: 'CRM — Template AI' },
  { value: 'engage_sequence_ai', label: 'CRM — Sequence AI' },
]

const MODEL_OPTIONS = [
  { value: '', label: 'All Models' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'claude-3-opus', label: 'Claude 3 Opus' },
  { value: 'claude-3-sonnet', label: 'Claude 3 Sonnet' },
  { value: 'claude-3-haiku', label: 'Claude 3 Haiku' },
]

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  if (isNaN(d)) return ts
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function agentShort(name) {
  if (!name) return '—'
  const m = name.match(/agent_(\d+)_(.+)/i)
  if (m) return `Agent ${m[1].padStart(2, '0')}`
  return name
}

function SkeletonRow({ cols }) {
  return (
    <tr>
      {[...Array(cols)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 rounded bg-slate-200 dark:bg-slate-800 animate-pulse"
            style={{ width: `${50 + (i * 13) % 40}%` }}
          />
        </td>
      ))}
    </tr>
  )
}

export default function CallsLog() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [agentFilter, setAgentFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    fetchCalls({
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      agent: agentFilter,
      model: modelFilter,
    })
      .then(res => {
        if (Array.isArray(res)) {
          setRows(res)
          setTotal(res.length < PAGE_SIZE ? page * PAGE_SIZE + res.length : (page + 2) * PAGE_SIZE)
        } else {
          setRows(res.rows ?? res.data ?? res.calls ?? res.items ?? [])
          setTotal(res.total ?? res.count ?? 0)
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [page, agentFilter, modelFilter])

  useEffect(() => { load() }, [load])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  function handleFilterChange(setter) {
    return (e) => {
      setter(e.target.value)
      setPage(0)
    }
  }

  const columns = ['Time', 'Agent', 'Model', 'Prompt Tokens', 'Completion Tokens', 'Total', 'Cost']

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden transition-colors">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-slate-900 dark:text-slate-100 font-semibold text-base">Recent Calls Log</h2>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">Individual API call records</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={agentFilter}
            onChange={handleFilterChange(setAgentFilter)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {AGENT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select
            value={modelFilter}
            onChange={handleFilterChange(setModelFilter)}
            className="text-sm border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            {MODEL_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={load}
            className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              {columns.map(col => (
                <th
                  key={col}
                  className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-4 py-3 whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {loading ? (
              [...Array(8)].map((_, i) => <SkeletonRow key={i} cols={7} />)
            ) : error ? (
              <tr>
                <td colSpan={7} className="px-4 py-12">
                  <EmptyState icon="⚠️" message="Failed to load calls" hint={error} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12">
                  <EmptyState icon="📋" message="No calls found" hint="Try adjusting the filters above" />
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr
                  key={row.id ?? i}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">
                    {formatTime(row.timestamp ?? row.created_at ?? row.time)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block bg-indigo-50 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-xs font-medium px-2 py-0.5 rounded">
                      {agentShort(row.agent)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300 text-xs font-mono">
                    {row.model ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 dark:text-slate-300">
                    {(row.prompt_tokens ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-600 dark:text-slate-300">
                    {(row.completion_tokens ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-200 font-medium">
                    {(row.total_tokens ?? (row.prompt_tokens ?? 0) + (row.completion_tokens ?? 0)).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right text-green-700 dark:text-green-400 font-semibold">
                    ${(row.estimated_cost_usd ?? row.cost_usd ?? 0).toFixed(5)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {!error && (
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {loading ? 'Loading…' : `${rows.length} rows • Page ${page + 1}${totalPages > 1 ? ` of ${totalPages}` : ''}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(0)}
              disabled={page === 0 || loading}
              className="px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              «
            </button>
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              ‹ Prev
            </button>
            <span className="px-2 text-xs text-slate-500 dark:text-slate-400">{page + 1}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={(rows.length < PAGE_SIZE) || loading}
              className="px-2 py-1 rounded text-xs text-slate-500 dark:text-slate-400 disabled:opacity-30 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
