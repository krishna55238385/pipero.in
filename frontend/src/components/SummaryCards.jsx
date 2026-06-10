function StatCard({ title, value, sub, icon, color }) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-5 flex items-start gap-4 transition-colors">
      <div className={`w-11 h-11 rounded-lg flex items-center justify-center text-xl flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase tracking-wide mb-0.5">{title}</p>
        <p className="text-slate-900 dark:text-slate-100 text-2xl font-bold truncate">{value}</p>
        {sub && <p className="text-slate-400 dark:text-slate-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 p-5 flex items-start gap-4">
      <div className="w-11 h-11 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-2 pt-1">
        <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="h-7 w-32 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
        <div className="h-2.5 w-20 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
      </div>
    </div>
  )
}

export default function SummaryCards({ summary, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
      </div>
    )
  }

  const calls = summary?.total_calls ?? 0
  const tokens = summary?.total_tokens ?? 0
  const cost = summary?.total_cost_usd ?? 0
  const avgCost = calls > 0 ? cost / calls : 0

  const cards = [
    {
      title: 'Total API Calls',
      value: calls.toLocaleString(),
      sub: 'All agents combined',
      icon: '⚡',
      color: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300',
    },
    {
      title: 'Total Tokens Used',
      value: tokens >= 1_000_000
        ? `${(tokens / 1_000_000).toFixed(2)}M`
        : tokens >= 1000
        ? `${(tokens / 1000).toFixed(1)}K`
        : tokens.toLocaleString(),
      sub: 'Prompt + completion',
      icon: '🔤',
      color: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300',
    },
    {
      title: 'Total Cost',
      value: `$${cost.toFixed(4)}`,
      sub: 'USD',
      icon: '💰',
      color: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-300',
    },
    {
      title: 'Avg Cost per Call',
      value: `$${avgCost.toFixed(5)}`,
      sub: calls > 0 ? `Across ${calls} calls` : 'No calls yet',
      icon: '📉',
      color: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-300',
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map(card => (
        <StatCard key={card.title} {...card} />
      ))}
    </div>
  )
}
