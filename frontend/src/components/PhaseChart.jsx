import { useState, useEffect } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { fetchByPhase } from '../api'
import EmptyState from './EmptyState'

function prettifyPhase(name) {
  if (!name) return 'Unknown'
  const m = String(name).match(/^phase[_-]?(\d+)$/i)
  if (m) return `Phase ${parseInt(m[1], 10)}`
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatCost(val) {
  if (val == null) return '$0'
  if (val >= 1) return `$${val.toFixed(2)}`
  return `$${val.toFixed(4)}`
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload ?? {}
  return (
    <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg space-y-0.5">
      <p className="font-semibold mb-1">{d.name}</p>
      <p>Cost: <span className="text-green-300">${(d.cost_usd ?? 0).toFixed(4)}</span></p>
      <p>Tokens: <span className="text-indigo-300">{(d.total_tokens ?? 0).toLocaleString()}</span></p>
      <p>Calls: <span className="text-indigo-300">{(d.calls ?? 0).toLocaleString()}</span></p>
      <p>Agents: <span className="text-indigo-300">{d.agent_count ?? 0}</span></p>
    </div>
  )
}


export default function PhaseChart({ fullWidth }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchByPhase()
      .then(res => {
        const list = Array.isArray(res) ? res : (res?.data ?? res?.phases ?? [])
        setRows(list)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const data = rows
    .map(r => ({
      name: prettifyPhase(r.phase),
      phase: r.phase,
      calls: r.calls ?? 0,
      total_tokens: r.total_tokens ?? 0,
      cost_usd: r.cost_usd ?? 0,
      agent_count: r.agent_count ?? 0,
    }))
    .sort((a, b) => b.cost_usd - a.cost_usd)

  // Build a lookup so the axis tick can reliably read agent_count by name.
  const dataByName = Object.fromEntries(data.map(d => [d.name, d]))
  const CustomTick = ({ x, y, payload }) => {
    const row = dataByName[payload?.value] ?? {}
    const agentCount = row.agent_count ?? 0
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={-10} y={0} dy={4} textAnchor="end" fontSize={12} fill="currentColor">
          <tspan className="fill-slate-700 dark:fill-slate-200 font-medium">{payload.value}</tspan>
          <tspan className="fill-slate-400 dark:fill-slate-500" dx={6} fontSize={10}>
            · {agentCount} {agentCount === 1 ? 'agent' : 'agents'}
          </tspan>
        </text>
      </g>
    )
  }

  const chartHeight = fullWidth ? Math.max(320, data.length * 52) : 300

  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 transition-colors ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-slate-900 dark:text-slate-100 font-semibold text-base">
            Cost by Phase
          </h2>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">
            Spend per pipeline phase, scaled across agents
          </p>
        </div>
        {!loading && data.length > 0 && (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            {data.length} {data.length === 1 ? 'phase' : 'phases'}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-800 animate-pulse flex-shrink-0" />
              <div
                className="h-6 rounded bg-slate-200 dark:bg-slate-800 animate-pulse flex-1"
                style={{ maxWidth: `${65 + i * 6}%` }}
              />
            </div>
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon="⚠️"
          message="Failed to load phase data"
          hint={error}
          className="h-48"
        />
      ) : data.length === 0 ? (
        <EmptyState
          icon="🪜"
          message="No phase data yet"
          hint="Phase breakdowns will appear once agents start running"
          className="h-48"
        />
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 24, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" className="dark:stroke-slate-800" />
            <XAxis
              type="number"
              tickFormatter={formatCost}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={180}
              tick={<CustomTick />}
              axisLine={false}
              tickLine={false}
              interval={0}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} />
            <Bar dataKey="cost_usd" radius={[0, 4, 4, 0]} maxBarSize={36}>
              {data.map((_, index) => (
                <Cell
                  key={index}
                  fill={`hsl(${24 + index * 14}, 85%, ${58 - index * 2}%)`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
