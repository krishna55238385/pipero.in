export default function EmptyState({ icon = '📭', message = 'No data yet', hint, className = '' }) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 ${className}`}
    >
      <span className="text-3xl mb-2" role="img" aria-label="empty">{icon}</span>
      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{message}</p>
      {hint && (
        <p className="text-xs mt-1 text-slate-400 dark:text-slate-500">{hint}</p>
      )}
    </div>
  )
}
