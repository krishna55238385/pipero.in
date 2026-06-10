import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import EmptyState from './EmptyState'

const MODEL_COLORS = {
  'gpt-4o': '#6366f1',
  'gpt-4o-mini': '#818cf8',
  'gpt-4-turbo': '#3b82f6',
  'gpt-3.5-turbo': '#60a5fa',
  'claude-3-opus': '#f97316',
  'claude-3-sonnet': '#fb923c',
  'claude-3-haiku': '#fdba74',
  'gemini-pro': '#22c55e',
  'gemini-1.5-pro': '#4ade80',
}

const FALLBACK_COLORS = [
  '#6366f1', '#f97316', '#22c55e', '#3b82f6', '#ec4899',
  '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#06b6d4',
]

function modelColor(name, index) {
  return MODEL_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

const RADIAN = Math.PI / 180

const CustomLabel = ({ cx, cy, midAngle, outerRadius, percent }) => {
  if (percent < 0.05) return null
  const r = outerRadius + 18
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className="text-xs fill-slate-600 dark:fill-slate-300" fontSize={11}>
      {`${(percent * 100).toFixed(1)}%`}
    </text>
  )
}

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg space-y-1">
      <p className="font-semibold">{d.model}</p>
      <p>Calls: <span className="text-indigo-300">{d.calls}</span></p>
      <p>Tokens: <span className="text-indigo-300">{d.total_tokens?.toLocaleString()}</span></p>
      <p>Cost: <span className="text-green-300">${d.cost_usd?.toFixed(4)}</span></p>
    </div>
  )
}

export default function ModelPieChart({ summary, loading, fullWidth }) {
  const byModel = summary?.by_model ?? {}

  const data = Object.entries(byModel).map(([modelKey, m], i) => ({
    model: modelKey,
    calls: m.calls ?? 0,
    total_tokens: m.total_tokens ?? 0,
    cost_usd: m.cost_usd ?? 0,
    value: m.calls ?? 0,
    color: modelColor(modelKey, i),
  }))

  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 transition-colors ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      <div className="mb-4">
        <h2 className="text-slate-900 dark:text-slate-100 font-semibold text-base">Model Breakdown</h2>
        <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">API calls per model</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="w-40 h-40 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon="🧠" message="No model data available" className="h-64" />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
                labelLine={false}
                label={CustomLabel}
              >
                {data.map((entry) => (
                  <Cell key={entry.model} fill={entry.color} stroke="white" strokeWidth={2} className="dark:stroke-slate-900" />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          <div className="mt-3 space-y-2">
            {data.map(m => (
              <div key={m.model} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: m.color }}
                  />
                  <span className="text-slate-700 dark:text-slate-200 font-medium truncate">{m.model}</span>
                </div>
                <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400 flex-shrink-0 ml-2">
                  <span>{m.calls} calls</span>
                  <span className="text-green-600 dark:text-green-400 font-medium">${m.cost_usd.toFixed(4)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
