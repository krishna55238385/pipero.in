'use client'

import { useEffect, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ShieldCheck, FileText, Link2, Mail, Download, Users } from 'lucide-react'
import {
  getMailSettings,
  exportMailLeadsCsvAction,
  getBillingUsageSnapshotAction,
  getWorkspaceLifecycleAction,
} from '@/app/actions/mail'
import type { MailSettings } from '@/types/mail'
import Link from 'next/link'

export default function MailComplianceClient() {
  const [settings, setSettings] = useState<MailSettings | null>(null)
  const [lifecycle, setLifecycle] = useState<Awaited<ReturnType<typeof getWorkspaceLifecycleAction>> | null>(null)
  const [billing, setBilling] = useState<Awaited<ReturnType<typeof getBillingUsageSnapshotAction>> | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    void Promise.all([
      getMailSettings(),
      getWorkspaceLifecycleAction(),
      getBillingUsageSnapshotAction(),
    ]).then(([s, life, bill]) => {
      setSettings(s)
      setLifecycle(life)
      setBilling(bill)
    })
  }, [])

  async function exportDsrPack() {
    setExporting(true)
    try {
      const csv = await exportMailLeadsCsvAction()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `gdpr-lead-export-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  const checks = [
    {
      ok: Boolean(settings?.unsubscribeLink),
      title: 'RFC 8058 one-click unsubscribe',
      detail: 'List-Unsubscribe + List-Unsubscribe-Post headers on every campaign send',
      icon: Link2,
    },
    {
      ok: Boolean((settings?.physicalAddress || '').trim()),
      title: 'CAN-SPAM physical address',
      detail: settings?.physicalAddress || 'Set physical address in Mail Settings',
      icon: FileText,
    },
    {
      ok: Boolean(settings?.openTracking !== undefined),
      title: 'Open / click tracking controls',
      detail: `Open: ${settings?.openTracking ? 'on' : 'off'} · Click: ${settings?.clickTracking ? 'on' : 'off'}`,
      icon: Mail,
    },
    {
      ok: true,
      title: 'Suppression enforced at send + enrollment',
      detail: 'Org-wide do-not-contact list blocks enrollments and live sends',
      icon: ShieldCheck,
    },
    {
      ok: lifecycle?.status === 'active' || lifecycle?.status === 'grace',
      title: 'Workspace lifecycle',
      detail: lifecycle
        ? `Status ${lifecycle.status}${lifecycle.graceEndsAt ? ` · grace until ${new Date(lifecycle.graceEndsAt).toLocaleDateString()}` : ''}`
        : 'Active',
      icon: Users,
    },
  ]

  return (
    <div className="space-y-6">
      <MailPageHeader
        title="Compliance Center"
        description="Google/Yahoo sender requirements, CAN-SPAM/GDPR, unsubscribe, DSR exports, and workspace policy"
      />

      <div className="grid gap-3">
        {checks.map((c) => (
          <Card key={c.title}>
            <CardContent className="pt-4 flex items-start gap-3">
              <c.icon className="h-5 w-5 mt-0.5 text-muted-foreground" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{c.title}</p>
                  <Badge variant={c.ok ? 'default' : 'destructive'}>{c.ok ? 'Ready' : 'Action needed'}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{c.detail}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">GDPR data subject export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Export lead records for this workspace (email, name, company, verification, source).
              Use suppression tools to honor erasure after legal review.
            </p>
            <Button size="sm" disabled={exporting} onClick={() => void exportDsrPack()}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {exporting ? 'Exporting…' : 'Export leads CSV'}
            </Button>
            <div className="flex gap-2 text-xs">
              <Link href="/engage/suppression" className="underline text-muted-foreground">
                Suppression list
              </Link>
              <Link href="/engage/settings" className="underline text-muted-foreground">
                Physical address settings
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Policy notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Complaint rate auto-pause threshold: 0.3% (Google/Yahoo).</p>
            <p>SPF + DKIM required before warmup; DMARC may use at-risk override.</p>
            <p>Credentials encrypted at rest (AES-256-GCM / optional KMS).</p>
            <p>
              Plan usage: {billing?.usage.mailboxes ?? 0}/{billing?.plan.maxMailboxes ?? '—'} mailboxes ·{' '}
              {billing?.usage.sendsToday ?? 0}/{billing?.plan.maxSendsPerDay ?? '—'} sends today.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
