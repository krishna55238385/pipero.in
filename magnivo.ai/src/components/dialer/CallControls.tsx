'use client'

import { Mic, Pause, Phone, PhoneOff, Volume2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CallStatus } from '@/components/dialer/types'

export default function CallControls({
  status,
  muted,
  onCall,
  onEnd,
  onMute,
  onHold,
}: {
  status: CallStatus
  muted: boolean
  onCall: () => void
  onEnd: () => void
  onMute: () => void
  onHold: () => void
}) {
  const callDisabled = status === 'Calling' || status === 'Connected'
  const inSession = status === 'Calling' || status === 'Connected'

  return (
    <div className="sticky bottom-0 -mx-3 md:mx-0 pt-2">
      <div className="bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70 border rounded-2xl p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={onCall}
              disabled={callDisabled}
              className="h-12 w-12 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm"
              aria-label="Call"
              title="Call"
            >
              <Phone className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              onClick={onEnd}
              disabled={!inSession && status !== 'Ended'}
              className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-sm"
              aria-label="End call"
              title="End"
            >
              <PhoneOff className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={muted ? 'default' : 'outline'}
              onClick={onMute}
              disabled={!inSession}
              className="h-12 rounded-full px-4"
            >
              {muted ? <Volume2 className="h-4 w-4 mr-2" /> : <Mic className="h-4 w-4 mr-2" />}
              {muted ? 'Unmute' : 'Mute'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onHold}
              disabled={!inSession}
              className="h-12 rounded-full px-4"
            >
              <Pause className="h-4 w-4 mr-2" /> Hold
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

