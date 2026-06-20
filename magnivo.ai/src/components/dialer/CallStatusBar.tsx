'use client'

import { PhoneCall } from 'lucide-react'
import type { CallStatus } from '@/components/dialer/types'

function formatTime(totalSeconds: number) {
  const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0')
  const secs = (totalSeconds % 60).toString().padStart(2, '0')
  return `${mins}:${secs}`
}

export default function CallStatusBar({
  status,
  timerSeconds,
}: {
  status: CallStatus
  timerSeconds: number
}) {
  const dotClass =
    status === 'Connected'
      ? 'bg-emerald-500'
      : status === 'Calling'
        ? 'bg-amber-500'
        : status === 'Ended'
          ? 'bg-red-500'
          : 'bg-slate-500'

  return (
    <div className="border rounded-xl px-3 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`relative w-2.5 h-2.5 rounded-full ${dotClass}`}>
          {status === 'Calling' && <span className="absolute inset-0 rounded-full animate-ping bg-amber-400/80" />}
        </span>
        <span className="text-sm font-medium flex items-center gap-2">
          <PhoneCall className="h-4 w-4" />
          {status}
        </span>
      </div>
      <span className="font-mono text-sm">{formatTime(timerSeconds)}</span>
    </div>
  )
}

