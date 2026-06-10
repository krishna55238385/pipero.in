import { useState, useEffect } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { fetchTimeline } from '../api'
import EmptyState from './EmptyState'

const DAY_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 14 days', value: 14 },
  { label: 'Last 30 days', value: 30 },
]

function formatDate(dateStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg space-y-1">
      <p className="font-semibold text-slate-300">{formatDate(label)}</p>
      {payload.map(p => (
        <p key={p.name}>
          <span style={{ color: p.color }}>{p.name === 'cost_usd' ? 'Cost' : 'Calls'}: </span>
          <span className="font-medium">
            {p.name === 'cost_usd' ? `$${Number(p.value).toFixed(4)}` : p.value}
          </span>
        </p>
      ))}
    </div>
  )
}

export default function CostTimeline() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchTimeline(days)
      .then(res => {
        const rows = Array.isArray(res) ? res : (res.data ?? res.timeline ?? [])
        setData(rows)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [days])

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-slate-900 dark:text-slate-100 font-semibold text-base">Cost Timeline</h2>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">
            Daily spend and call volume over time
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
          {DAY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                days === opt.value
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-64 flex items-center justify-center">
          <div className="space-y-2 w-full">
            <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 animate-pulse w-full" />
            <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 animate-pulse w-5/6" />
            <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 animate-pulse w-4/6" />
            <div className="h-2 rounded bg-slate-200 dark:bg-slate-800 animate-pulse w-full" />
            <div className="h-48 rounded bg-slate-200 dark:bg-slate-800 animate-pulse w-full mt-4" />
          </div>
        </div>
      ) : error ? (
        <EmptyState
          icon="⚠️"
          message="Failed to load timeline data"
          hint={error}
          className="h-64"
        />
      ) : data.length === 0 ? (
        <EmptyState
          icon="📈"
          message="No data for this period"
          hint="Try a wider date range"
          className="h-64"
        />
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 4, right: 24, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-800" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="cost"
              orientation="left"
              tickFormatter={v => `$${v.toFixed(3)}`}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={60}
            />
            <YAxis
              yAxisId="calls"
              orientation="right"
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              formatter={val => (
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {val === 'cost_usd' ? 'Cost (USD)' : 'Calls'}
                </span>
              )}
            />
            <Line
              yAxisId="cost"
              type="monotone"
              dataKey="cost_usd"
              stroke="#6366f1"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#6366f1' }}
              activeDot={{ r: 5 }}
            />
            <Line
              yAxisId="calls"
              type="monotone"
              dataKey="calls"
              stroke="#f97316"
              strokeWidth={2.5}
              dot={{ r: 3, fill: '#f97316' }}
              activeDot={{ r: 5 }}
              strokeDasharray="5 3"
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
