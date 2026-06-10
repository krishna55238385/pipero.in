import { useState, useEffect } from 'react'
import SummaryCards from './components/SummaryCards'
import AgentBarChart from './components/AgentBarChart'
import AgentBreakdown from './components/AgentBreakdown'
import CostTimeline from './components/CostTimeline'
import ModelPieChart from './components/ModelPieChart'
import IcpCostTable from './components/IcpCostTable'
import CallsLog from './components/CallsLog'
import PhaseChart from './components/PhaseChart'
import { fetchSummary } from './api'

const THEME_KEY = 'ai-gtm-theme'

function getInitialTheme() {
  if (typeof window === 'undefined') return 'light'
  try {
    const stored = window.localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch (_) {
    // localStorage unavailable; fall through
  }
  return 'light'
}

function App() {
  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [activeSection, setActiveSection] = useState('overview')
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    try {
      window.localStorage.setItem(THEME_KEY, theme)
    } catch (_) {
      // ignore
    }
  }, [theme])

  useEffect(() => {
    setSummaryLoading(true)
    fetchSummary()
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false))
  }, [])

  const totalCost = summary?.total_cost_usd ?? null

  const navItems = [
    { id: 'overview', label: 'Overview', icon: '📊' },
    { id: 'agents', label: 'By Agent', icon: '🤖' },
    { id: 'phase', label: 'By Phase', icon: '🪜' },
    { id: 'timeline', label: 'Timeline', icon: '📈' },
    { id: 'models', label: 'Models', icon: '🧠' },
    { id: 'icp', label: 'By ICP', icon: '🎯' },
    { id: 'calls', label: 'Recent Calls', icon: '📋' },
  ]

  function toggleTheme() {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 dark:bg-slate-950 transition-colors">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 dark:bg-slate-950 dark:border-r dark:border-slate-800 flex flex-col flex-shrink-0">
        <div className="px-6 py-5 border-b border-slate-700 dark:border-slate-800">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xl">🤖</span>
            <span className="text-white font-bold text-sm leading-tight">AI GTM Agency</span>
          </div>
          <p className="text-slate-400 text-xs">LLM Usage Dashboard</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                activeSection === item.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800 dark:hover:bg-slate-900'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-slate-700 dark:border-slate-800">
          <div className="bg-slate-800 dark:bg-slate-900 rounded-lg px-3 py-2.5">
            <p className="text-slate-400 text-xs mb-0.5">Total Spend</p>
            {summaryLoading ? (
              <div className="h-5 w-20 rounded bg-slate-700 animate-pulse" />
            ) : totalCost !== null ? (
              <p className="text-green-400 font-bold text-base">
                ${totalCost.toFixed(4)}
              </p>
            ) : (
              <p className="text-slate-500 text-sm">—</p>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-8 py-4 flex items-center justify-between flex-shrink-0 transition-colors">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              {navItems.find(n => n.id === activeSection)?.label ?? 'Dashboard'}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              AI GTM Agency — LLM Usage Dashboard
            </p>
          </div>
          <div className="flex items-center gap-3">
            {!summaryLoading && totalCost !== null && (
              <span className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 text-sm font-semibold px-3 py-1.5 rounded-full border border-indigo-200 dark:border-indigo-500/30">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                Total: ${totalCost.toFixed(4)}
              </span>
            )}
            <span className="text-slate-400 dark:text-slate-500 text-xs">
              {new Date().toLocaleString()}
            </span>
            <button
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              className="w-9 h-9 rounded-full flex items-center justify-center text-base border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-8 py-6 space-y-6 bg-slate-100 dark:bg-slate-950 transition-colors">
          {(activeSection === 'overview') && (
            <>
              <SummaryCards summary={summary} loading={summaryLoading} />
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <AgentBarChart summary={summary} loading={summaryLoading} />
                <PhaseChart />
              </div>
              <ModelPieChart summary={summary} loading={summaryLoading} />
              <CostTimeline />
            </>
          )}

          {activeSection === 'agents' && (
            <>
              <AgentBreakdown />
              <AgentBarChart summary={summary} loading={summaryLoading} fullWidth />
            </>
          )}

          {activeSection === 'phase' && (
            <PhaseChart fullWidth />
          )}

          {activeSection === 'timeline' && (
            <CostTimeline />
          )}

          {activeSection === 'models' && (
            <ModelPieChart summary={summary} loading={summaryLoading} fullWidth />
          )}

          {activeSection === 'icp' && (
            <IcpCostTable />
          )}

          {activeSection === 'calls' && (
            <CallsLog />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
