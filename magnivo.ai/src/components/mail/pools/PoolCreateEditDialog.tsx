'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { XCircle, Loader2 } from 'lucide-react'
import type {
  MailboxPoolResponse,
  CreateMailboxPoolRequest,
  UpdateMailboxPoolRequest,
  SendingStrategy,
  RotationStrategy,
} from '@/types/mail'

type PoolCreateEditDialogProps = {
  pool?: MailboxPoolResponse | null
  onSave: (data: CreateMailboxPoolRequest | UpdateMailboxPoolRequest) => Promise<void>
  onClose: () => void
}

const SENDING_STRATEGIES: { value: SendingStrategy; label: string; desc: string }[] = [
  { value: 'standard', label: 'Standard', desc: 'Normal sending speed' },
  { value: 'throttled', label: 'Throttled', desc: 'Reduced sending rate' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Maximum sending speed' },
  { value: 'conservative', label: 'Conservative', desc: 'Very cautious sending' },
]

const ROTATION_STRATEGIES: { value: RotationStrategy; label: string; desc: string }[] = [
  { value: 'round_robin', label: 'Round Robin', desc: 'Equal distribution' },
  { value: 'weighted', label: 'Weighted', desc: 'Based on mailbox weights' },
  { value: 'least_used', label: 'Least Used', desc: 'Prefer less-used mailboxes' },
  { value: 'random', label: 'Random', desc: 'Random selection' },
  { value: 'priority', label: 'Priority', desc: 'Highest priority first' },
  { value: 'adaptive', label: 'Adaptive', desc: 'Based on performance' },
]

export function PoolCreateEditDialog({ pool, onSave, onClose }: PoolCreateEditDialogProps) {
  const [name, setName] = useState(pool?.name ?? '')
  const [description, setDescription] = useState(pool?.description ?? '')
  const [dailyPoolLimit, setDailyPoolLimit] = useState(pool?.dailyPoolLimit?.toString() ?? '500')
  const [sendingStrategy, setSendingStrategy] = useState<SendingStrategy>(pool?.sendingStrategy ?? 'standard')
  const [rotationStrategy, setRotationStrategy] = useState<RotationStrategy>(pool?.rotationStrategy ?? 'round_robin')
  const [maxConcurrentSends, setMaxConcurrentSends] = useState(pool?.maxConcurrentSends?.toString() ?? '5')
  const [timezone, setTimezone] = useState(pool?.timezone ?? 'UTC')
  const [isSaving, setIsSaving] = useState(false)

  const isEditing = !!pool

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || isSaving) return

    setIsSaving(true)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        dailyPoolLimit: parseInt(dailyPoolLimit) || 500,
        sendingStrategy,
        rotationStrategy,
        maxConcurrentSends: parseInt(maxConcurrentSends) || 5,
        timezone,
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {isEditing ? `Edit Pool: ${pool.name}` : 'Create Pool'}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Pool Name *</label>
              <Input
                placeholder="e.g. Primary Outreach Pool"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Daily Limit</label>
                <Input
                  type="number"
                  min={1}
                  max={50000}
                  value={dailyPoolLimit}
                  onChange={(e) => setDailyPoolLimit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Max Concurrent</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={maxConcurrentSends}
                  onChange={(e) => setMaxConcurrentSends(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Timezone</label>
              <Input
                placeholder="UTC"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Sending Strategy</label>
              <div className="grid grid-cols-2 gap-2">
                {SENDING_STRATEGIES.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSendingStrategy(s.value)}
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      sendingStrategy === s.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <p className="text-xs font-medium">{s.label}</p>
                    <p className="text-[10px] text-muted-foreground">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Rotation Strategy</label>
              <div className="grid grid-cols-3 gap-2">
                {ROTATION_STRATEGIES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRotationStrategy(r.value)}
                    className={`p-2 rounded-lg border text-left transition-colors ${
                      rotationStrategy === r.value
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/30'
                    }`}
                  >
                    <p className="text-xs font-medium">{r.label}</p>
                    <p className="text-[10px] text-muted-foreground">{r.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!name.trim() || isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  isEditing ? 'Save Changes' : 'Create Pool'
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
