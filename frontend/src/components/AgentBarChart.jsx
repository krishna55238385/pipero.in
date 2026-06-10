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
import EmptyState from './EmptyState'

export const AGENT_LABELS = {
  agent_01_icp: '01 · ICP Definition',
  agent_02_leads: '02 · Lead Generation',
  agent_03_enrichment: '03 · Enrichment',
  agent_04_signals: '04 · Buying Signals',
  agent_05_scoring: '05 · ICP Scoring',
  agent_06_account_intel: '06 · Account Intelligence',
  agent_07_stakeholders: '07 · Stakeholder Mapping',
  agent_08_competitive: '08 · Competitive Intel',
  agent_09_market_sizing: '09 · Market Sizing',
  agent_10_gtm_insights: '10 · GTM Insights',
}

function prettifyAgent(name) {
  if (!name) return 'Unknown'
  return AGENT_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function formatTokens(val) {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1000) return `${(val / 1000).toFixed(1)}K`
  return val
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg">
      <p className="font-semibold mb-1">{label}</p>
      <p>Tokens: <span className="text-indigo-300">{payload[0]?.value?.toLocaleString()}</span></p>
      {payload[0]?.payload?.calls !== undefined && (
        <p>Calls: <span className="text-indigo-300">{payload[0].payload.calls}</span></p>
      )}
      {payload[0]?.payload?.cost_usd !== undefined && (
        <p>Cost: <span className="text-green-300">${payload[0].payload.cost_usd.toFixed(4)}</span></p>
      )}
    </div>
  )
}

export default function AgentBarChart({ summary, loading, fullWidth }) {
  const byAgent = summary?.by_agent ?? {}

  const data = Object.entries(byAgent)
    .map(([agentKey, a]) => ({
      name: prettifyAgent(agentKey),
      total_tokens: a.total_tokens ?? 0,
      calls: a.calls ?? 0,
      cost_usd: a.cost_usd ?? 0,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens)

  const chartHeight = fullWidth ? Math.max(300, data.length * 52) : 300

  return (
    <div
      className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 transition-colors ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-slate-900 dark:text-slate-100 font-semibold text-base">Token Usage by Agent</h2>
          <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">Total tokens consumed per agent</p>
        </div>
        {!loading && data.length > 0 && (
          <span className="text-xs text-slate-400 dark:text-slate-500">{data.length} agents</span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-3 w-32 rounded bg-slate-200 dark:bg-slate-800 animate-pulse flex-shrink-0" />
              <div
                className="h-6 rounded bg-slate-200 dark:bg-slate-800 animate-pulse flex-1"
                style={{ maxWidth: `${60 + i * 8}%` }}
              />
            </div>
          ))}
        </div>
      ) : data.length === 0 ? (
        <EmptyState icon="🤖" message="No agent data available" className="h-48" />
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" className="dark:stroke-slate-800" />
            <XAxis
              type="number"
              tickFormatter={formatTokens}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={170}
              tick={{ fontSize: 12, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.1)' }} />
            <Bar dataKey="total_tokens" radius={[0, 4, 4, 0]} maxBarSize={36}>
              {data.map((_, index) => (
                <Cell
                  key={index}
                  fill={`hsl(${238 + index * 8}, 70%, ${58 - index * 3}%)`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
