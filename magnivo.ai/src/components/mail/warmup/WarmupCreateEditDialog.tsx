'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { createWarmupAction, updateWarmupConfigAction, listWarmupTemplatesAction } from '@/app/actions/mail'
import type { CreateWarmupConfigRequest, UpdateWarmupConfigRequest, WarmupTemplate, WarmupConfigResponse } from '@/types/mail'
import { getMailErrorMessage } from '@/types/mail'

type WarmupCreateEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
  editingConfig?: WarmupConfigResponse | null
}

export function WarmupCreateEditDialog({ open, onOpenChange, onComplete, editingConfig }: WarmupCreateEditDialogProps) {
  const isEditing = !!editingConfig
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<WarmupTemplate[]>([])

  const [mailboxId, setMailboxId] = useState(editingConfig?.mailboxId ?? '')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [maxDailySends, setMaxDailySends] = useState(String(editingConfig?.maxDailySends ?? 40))
  const [dailyIncrease, setDailyIncrease] = useState(String(editingConfig?.dailyIncrease ?? 2))
  const [initialSends, setInitialSends] = useState(String(editingConfig?.initialSends ?? 5))
  const [totalDays, setTotalDays] = useState(String(editingConfig?.totalDays ?? 30))
  const [weekendSending, setWeekendSending] = useState(editingConfig?.weekendSending ?? false)
  const [businessHoursStart, setBusinessHoursStart] = useState(String(editingConfig?.businessHoursStart ?? 8))
  const [businessHoursEnd, setBusinessHoursEnd] = useState(String(editingConfig?.businessHoursEnd ?? 18))
  const [replySimulation, setReplySimulation] = useState(editingConfig?.replySimulation ?? true)
  const [readSimulation, setReadSimulation] = useState(editingConfig?.readSimulation ?? true)
  const [openSimulation, setOpenSimulation] = useState(editingConfig?.openSimulation ?? true)
  const [clickSimulation, setClickSimulation] = useState(editingConfig?.clickSimulation ?? false)
  const [spamRescue, setSpamRescue] = useState(editingConfig?.spamRescue ?? true)

  async function loadTemplates() {
    try {
      const data = await listWarmupTemplatesAction()
      setTemplates(data)
    } catch {
      // silent
    }
  }

  function handleOpenChange(isOpen: boolean) {
    if (isOpen && !isEditing) {
      loadTemplates()
    }
    if (!isOpen) {
      setError(null)
      setSelectedTemplateId('')
    }
    onOpenChange(isOpen)
  }

  function applyTemplate(templateId: string) {
    const template = templates.find((t) => t.id === templateId)
    if (!template) return
    setSelectedTemplateId(templateId)
    setMaxDailySends(String(template.maxDailySends))
    setDailyIncrease(String(template.dailyIncrease))
    setInitialSends(String(template.initialSends))
    setTotalDays(String(template.totalDays))
    setWeekendSending(template.weekendSending)
    setBusinessHoursStart(String(template.businessHoursStart))
    setBusinessHoursEnd(String(template.businessHoursEnd))
    setReplySimulation(template.replySimulation)
    setReadSimulation(template.readSimulation)
    setOpenSimulation(template.openSimulation)
    setClickSimulation(template.clickSimulation)
    setSpamRescue(template.spamRescue)
  }

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    try {
      if (isEditing) {
        const input: UpdateWarmupConfigRequest = {
          maxDailySends: Number(maxDailySends),
          dailyIncrease: Number(dailyIncrease),
          initialSends: Number(initialSends),
          totalDays: Number(totalDays),
          weekendSending,
          businessHoursStart: Number(businessHoursStart),
          businessHoursEnd: Number(businessHoursEnd),
          replySimulation,
          readSimulation,
          openSimulation,
          clickSimulation,
          spamRescue,
        }
        const result = await updateWarmupConfigAction(editingConfig.id, input)
        if (!result.success) {
          setError(getMailErrorMessage(result.error))
          return
        }
      } else {
        if (!mailboxId.trim()) {
          setError('Mailbox ID is required')
          return
        }
        const input: CreateWarmupConfigRequest = {
          mailboxId: mailboxId.trim(),
          templateId: selectedTemplateId || undefined,
          maxDailySends: Number(maxDailySends),
          dailyIncrease: Number(dailyIncrease),
          initialSends: Number(initialSends),
          totalDays: Number(totalDays),
          weekendSending,
          businessHoursStart: Number(businessHoursStart),
          businessHoursEnd: Number(businessHoursEnd),
          replySimulation,
          readSimulation,
          openSimulation,
          clickSimulation,
          spamRescue,
        }
        const result = await createWarmupAction(input)
        if (!result.success) {
          setError(getMailErrorMessage(result.error))
          return
        }
      }
      onComplete()
      onOpenChange(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Operation failed'
      setError(getMailErrorMessage(msg))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Warmup' : 'Start New Warmup'}</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Update the warmup configuration settings.' : 'Configure a new warmup process to build sender reputation.'}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-4">
          {!isEditing && (
            <>
              <div className="space-y-2">
                <Label htmlFor="mailboxId">Mailbox ID</Label>
                <Input
                  id="mailboxId"
                  value={mailboxId}
                  onChange={(e) => setMailboxId(e.target.value)}
                  placeholder="Enter mailbox ID"
                  className="h-9 text-sm"
                />
              </div>

              {templates.length > 0 && (
                <div className="space-y-2">
                  <Label>Apply Template</Label>
                  <Select value={selectedTemplateId} onValueChange={applyTemplate}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select a template (optional)" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} {t.isDefault ? '(Default)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="maxDailySends">Max Daily Sends</Label>
              <Input
                id="maxDailySends"
                type="number"
                value={maxDailySends}
                onChange={(e) => setMaxDailySends(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dailyIncrease">Daily Increase</Label>
              <Input
                id="dailyIncrease"
                type="number"
                value={dailyIncrease}
                onChange={(e) => setDailyIncrease(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="initialSends">Initial Sends</Label>
              <Input
                id="initialSends"
                type="number"
                value={initialSends}
                onChange={(e) => setInitialSends(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totalDays">Total Days</Label>
              <Input
                id="totalDays"
                type="number"
                value={totalDays}
                onChange={(e) => setTotalDays(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hoursStart">Hours Start</Label>
              <Input
                id="hoursStart"
                type="number"
                min={0}
                max={23}
                value={businessHoursStart}
                onChange={(e) => setBusinessHoursStart(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hoursEnd">Hours End</Label>
              <Input
                id="hoursEnd"
                type="number"
                min={0}
                max={23}
                value={businessHoursEnd}
                onChange={(e) => setBusinessHoursEnd(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Options</Label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Weekend Sending</span>
              <Switch checked={weekendSending} onCheckedChange={setWeekendSending} />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Simulation</Label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Reply Simulation</span>
              <Switch checked={replySimulation} onCheckedChange={setReplySimulation} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Read Simulation</span>
              <Switch checked={readSimulation} onCheckedChange={setReadSimulation} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Open Simulation</span>
              <Switch checked={openSimulation} onCheckedChange={setOpenSimulation} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Click Simulation</span>
              <Switch checked={clickSimulation} onCheckedChange={setClickSimulation} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Spam Rescue</span>
              <Switch checked={spamRescue} onCheckedChange={setSpamRescue} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={loading} onClick={handleSubmit}>
            {loading ? 'Saving...' : isEditing ? 'Save Changes' : 'Start Warmup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
