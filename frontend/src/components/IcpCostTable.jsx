import { useState, useEffect } from 'react'
import { fetchByIcp } from '../api'
import EmptyState from './EmptyState'

function tierBadge(cost) {
  if (cost >= 0.1) return { label: 'Hot', cls: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' }
  if (cost >= 0.01) return { label: 'Warm', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300' }
  return { label: 'Cold', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' }
}

function SkeletonRow() {
  return (
    <tr>
      {[...Array(4)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 rounded bg-slate-200 dark:bg-slate-800 animate-pulse"
            style={{ width: `${60 + i * 15}%` }}
          />
        </td>
      ))}
    </tr>
  )
}

export default function IcpCostTable() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchByIcp()
      .then(res => {
        const data = Array.isArray(res) ? res : (res.data ?? res.icps ?? [])
        setRows(data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const sorted = [...rows].sort((a, b) =>
    sortDir === 'desc' ? b.cost_usd - a.cost_usd : a.cost_usd - b.cost_usd
  )

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 overflow-hidden transition-colors">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div>
          <h2 className="text-slate-900 dark:text-slate-100 font-semibold text-base">Cost by ICP</h2>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">
            Spend breakdown per Ideal Customer Profile
          </p>
        </div>
        {!loading && rows.length > 0 && (
          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
          >
            Cost {sortDir === 'desc' ? '↓' : '↑'}
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              <th className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-4 py-3">
                ICP Name
              </th>
              <th className="text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-4 py-3">
                Calls
              </th>
              <th className="text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-4 py-3">
                Total Tokens
              </th>
              <th className="text-right text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide px-4 py-3">
                Cost (USD)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
            {loading ? (
              [...Array(5)].map((_, i) => <SkeletonRow key={i} />)
            ) : error ? (
              <tr>
                <td colSpan={4} className="px-4 py-12">
                  <EmptyState icon="⚠️" message="Failed to load ICP data" hint={error} />
                </td>
              </tr>
            ) : sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12">
                  <EmptyState icon="🎯" message="No ICP data available" />
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => {
                const badge = tierBadge(row.cost_usd ?? 0)
                return (
                  <tr
                    key={row.icp_name ?? i}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-100">
                          {row.icp_name ?? '—'}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {(row.calls ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                      {(row.total_tokens ?? 0).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800 dark:text-slate-100">
                      ${(row.cost_usd ?? 0).toFixed(4)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && !error && sorted.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 text-xs text-slate-400 dark:text-slate-500 text-right">
          {sorted.length} ICPs • Total: $
          {sorted.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)}
        </div>
      )}
    </div>
  )
}
