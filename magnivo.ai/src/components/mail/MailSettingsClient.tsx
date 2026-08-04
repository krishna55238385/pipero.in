'use client'

import { useEffect, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { MailSettings } from '@/types/mail'
import {
  getMailSettings,
  updateMailSettings,
  listSubAccountsAction,
  createSubAccountAction,
  getOrgUsageSummaryAction,
  getBillingUsageSnapshotAction,
  startWorkspaceGraceAction,
  restoreWorkspaceAction,
  getMailboxes,
  assignMailboxToSubAccountAction,
} from '@/app/actions/mail'

export default function MailSettingsClient({ isLoading: initialLoading = false }: { isLoading?: boolean }) {
  const [settings, setSettings] = useState<MailSettings | null>(null)
  const [subAccounts, setSubAccounts] = useState<Awaited<ReturnType<typeof listSubAccountsAction>>>([])
  const [activeSubAccountId, setActiveSubAccountId] = useState<string>('all')
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof getOrgUsageSummaryAction>> | null>(null)
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof getBillingUsageSnapshotAction>> | null>(null)
  const [mailboxes, setMailboxes] = useState<Awaited<ReturnType<typeof getMailboxes>>>([])
  const [assignMailboxId, setAssignMailboxId] = useState('')
  const [assignSubId, setAssignSubId] = useState('')
  const [newSubAccount, setNewSubAccount] = useState('')
  const [isLoading, setIsLoading] = useState(initialLoading)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setIsLoading(true)
    void Promise.all([
      getMailSettings(),
      listSubAccountsAction(),
      getOrgUsageSummaryAction(),
      getBillingUsageSnapshotAction(),
      getMailboxes(),
    ])
      .then(([s, subs, usageSummary, billingSnap, mbs]) => {
        setSettings(s)
        setSubAccounts(subs)
        setUsage(usageSummary)
        setBilling(billingSnap)
        setMailboxes(mbs)
        if (mbs[0]) setAssignMailboxId(mbs[0].id)
      })
      .finally(() => setIsLoading(false))
  }, [])

  async function save() {
    if (!settings) return
    setSaving(true)
    setMessage(null)
    const updated = await updateMailSettings(settings)
    setSaving(false)
    if (updated) {
      setSettings(updated)
      setMessage('Settings saved')
    } else {
      setMessage('Failed to save settings')
    }
  }

  async function addSubAccount() {
    const result = await createSubAccountAction(newSubAccount)
    if (result.success && result.data) {
      setSubAccounts((prev) => [...prev, result.data])
      setNewSubAccount('')
    } else if (!result.success) {
      setMessage(result.error || 'Failed to create sub-account')
    }
  }

  if (isLoading || !settings) {
    return (
      <div className="space-y-6">
        <MailPageHeader title="Settings" description="Configure your mail module preferences" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent>
                <div className="space-y-3 py-4">
                  <div className="h-4 w-32 bg-muted animate-pulse rounded-md" />
                  <div className="h-3 w-full bg-muted animate-pulse rounded-md" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <MailPageHeader title="Settings" description="Tracking, limits, signatures, and sub-accounts" />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email Tracking</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Tracking enabled"
            checked={settings.trackingEnabled}
            onChange={(v) => setSettings({ ...settings, trackingEnabled: v })}
          />
          <ToggleRow
            label="Open tracking"
            checked={settings.openTracking}
            onChange={(v) => setSettings({ ...settings, openTracking: v })}
          />
          <ToggleRow
            label="Click tracking"
            checked={settings.clickTracking}
            onChange={(v) => setSettings({ ...settings, clickTracking: v })}
          />
          <ToggleRow
            label="Unsubscribe link / List-Unsubscribe header"
            checked={settings.unsubscribeLink}
            onChange={(v) => setSettings({ ...settings, unsubscribeLink: v })}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send Limits</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="daily-limit">Default daily send limit</Label>
            <Input
              id="daily-limit"
              type="number"
              min={1}
              value={settings.dailySendLimit}
              onChange={(e) =>
                setSettings({ ...settings, dailySendLimit: Number(e.target.value) || 1 })
              }
            />
          </div>
          <ToggleRow
            label="Warmup enabled for new mailboxes"
            checked={settings.warmupEnabled}
            onChange={(v) => setSettings({ ...settings, warmupEnabled: v })}
          />
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="hourly-limit">Default hourly send limit</Label>
            <Input
              id="hourly-limit"
              type="number"
              min={1}
              value={settings.hourlySendLimit ?? 50}
              onChange={(e) =>
                setSettings({ ...settings, hourlySendLimit: Number(e.target.value) || 1 })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sending schedule & rotation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
            <div className="space-y-2">
              <Label htmlFor="bh-start">Business hours start</Label>
              <Input
                id="bh-start"
                type="number"
                min={0}
                max={23}
                value={settings.businessHoursStart ?? 9}
                onChange={(e) =>
                  setSettings({ ...settings, businessHoursStart: Number(e.target.value) })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bh-end">Business hours end</Label>
              <Input
                id="bh-end"
                type="number"
                min={1}
                max={24}
                value={settings.businessHoursEnd ?? 17}
                onChange={(e) =>
                  setSettings({ ...settings, businessHoursEnd: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="space-y-2 max-w-md">
            <Label htmlFor="tz">Default timezone</Label>
            <Input
              id="tz"
              value={settings.defaultTimezone ?? 'UTC'}
              onChange={(e) => setSettings({ ...settings, defaultTimezone: e.target.value })}
              placeholder="America/New_York"
            />
          </div>
          <div className="space-y-2 max-w-md">
            <Label htmlFor="rotation">Mailbox rotation strategy</Label>
            <select
              id="rotation"
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
              value={settings.rotationStrategy ?? 'round_robin'}
              onChange={(e) => setSettings({ ...settings, rotationStrategy: e.target.value })}
            >
              <option value="round_robin">Round robin</option>
              <option value="least_used">Least used</option>
              <option value="weighted">Weighted by health</option>
              <option value="random">Random</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Usage (this month)</CardTitle>
        </CardHeader>
        <CardContent>
          {usage ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <UsageStat label="Sends" value={usage.sends} />
              <UsageStat label="Opens" value={usage.opens} />
              <UsageStat label="Clicks" value={usage.clicks} />
              <UsageStat label="Replies" value={usage.replies} />
              <UsageStat label="Bounces" value={usage.bounces} />
              <UsageStat label="Unsubscribes" value={usage.unsubscribes} />
              <UsageStat label="Warmup sends" value={usage.warmupSends} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No usage recorded yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">CAN-SPAM Compliance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 max-w-md">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              value={settings.companyName || ''}
              onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="physical-address">Physical mailing address</Label>
            <textarea
              id="physical-address"
              className="w-full min-h-[80px] rounded-md border bg-background p-3 text-sm"
              value={settings.physicalAddress || ''}
              onChange={(e) => setSettings({ ...settings, physicalAddress: e.target.value })}
              placeholder="Required for campaign launch (CAN-SPAM)"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Default Signature</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className="w-full min-h-[120px] rounded-md border bg-background p-3 text-sm"
            value={settings.defaultSignature || ''}
            onChange={(e) => setSettings({ ...settings, defaultSignature: e.target.value })}
            placeholder="Optional email signature appended to sends"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team permissions (mail module)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Read</th>
                  <th className="py-2 pr-3">Write</th>
                  <th className="py-2 pr-3">Manage</th>
                  <th className="py-2">Admin</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['viewer', true, false, false, false],
                  ['member', true, true, false, false],
                  ['manager', true, true, true, false],
                  ['admin', true, true, true, true],
                ].map(([role, read, write, manage, admin]) => (
                  <tr key={String(role)} className="border-b border-border/50">
                    <td className="py-2 pr-3 capitalize font-medium">{role}</td>
                    <td className="py-2 pr-3">{read ? '✓' : '—'}</td>
                    <td className="py-2 pr-3">{write ? '✓' : '—'}</td>
                    <td className="py-2 pr-3">{manage ? '✓' : '—'}</td>
                    <td className="py-2">{admin ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Permissions resolve from Magnivo org roles via <code>resolveMailPermissions</code>. Soft-delete and API key management require Admin.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sub-accounts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2 max-w-md">
            <Label htmlFor="sub-account-switcher">Active sub-account</Label>
            <select
              id="sub-account-switcher"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={activeSubAccountId}
              onChange={(e) => setActiveSubAccountId(e.target.value)}
            >
              <option value="all">All sub-accounts (workspace)</option>
              {subAccounts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.status})
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Switch context for agency-style mailbox grouping. Assign mailboxes to sub-accounts from the mailbox dashboard.
            </p>
          </div>
          <div className="flex gap-2 max-w-md">
            <Input
              placeholder="Sub-account name"
              value={newSubAccount}
              onChange={(e) => setNewSubAccount(e.target.value)}
            />
            <Button onClick={() => void addSubAccount()}>Add</Button>
          </div>
          {subAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sub-accounts yet</p>
          ) : (
            <ul className="text-sm space-y-1">
              {subAccounts
                .filter((s) => activeSubAccountId === 'all' || s.id === activeSubAccountId)
                .map((s) => (
                  <li key={s.id} className="flex justify-between border-b py-2">
                    <span>{s.name}</span>
                    <span className="text-muted-foreground">{s.status}</span>
                  </li>
                ))}
            </ul>
          )}

          <div className="pt-3 border-t space-y-2">
            <Label>Assign mailbox to sub-account</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={assignMailboxId}
                onChange={(e) => setAssignMailboxId(e.target.value)}
                aria-label="Mailbox to assign"
              >
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.email}
                  </option>
                ))}
              </select>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={assignSubId}
                onChange={(e) => setAssignSubId(e.target.value)}
                aria-label="Target sub-account"
              >
                <option value="">Unassigned</option>
                {subAccounts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                onClick={async () => {
                  if (!assignMailboxId) return
                  const result = await assignMailboxToSubAccountAction(
                    assignMailboxId,
                    assignSubId || null
                  )
                  setMessage(result.success ? 'Mailbox assignment saved' : 'Assignment failed')
                }}
              >
                Assign
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan limits & billing hooks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!billing ? (
            <p className="text-sm text-muted-foreground">Unable to load usage snapshot</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ['Mailboxes', billing.usage.mailboxes, billing.plan.maxMailboxes, billing.percent.mailboxes],
                    ['Sends today', billing.usage.sendsToday, billing.plan.maxSendsPerDay, billing.percent.sends],
                    ['Leads', billing.usage.leads, billing.plan.maxLeads, billing.percent.leads],
                  ] as const
                ).map(([label, used, max, pct]) => (
                  <div key={label} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {used} / {max}
                    </p>
                    <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full ${pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-500' : 'bg-primary'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    {pct >= 90 && (
                      <p className="text-xs text-destructive mt-2">
                        Near plan limit — upgrade to avoid mid-campaign blocks.
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Month sends (metered): {billing.usage.monthSends}. Lifecycle: {billing.lifecycle.status}
                {billing.lifecycle.graceEndsAt
                  ? ` · grace ends ${new Date(billing.lifecycle.graceEndsAt).toLocaleDateString()}`
                  : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await startWorkspaceGraceAction(30, 'downgrade')
                    setBilling(await getBillingUsageSnapshotAction())
                    setMessage('Grace period started (30 days)')
                  }}
                >
                  Start downgrade grace
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await restoreWorkspaceAction()
                    setBilling(await getBillingUsageSnapshotAction())
                    setMessage('Workspace restored to active')
                  }}
                >
                  Restore active
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Button onClick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </div>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label>{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
    </div>
  )
}
