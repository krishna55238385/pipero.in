'use client'

import { motion } from 'framer-motion'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Mail, Shield, Server, AlertTriangle, Edit2, Globe } from 'lucide-react'
import type { MailboxProvider, WizardValues } from '@/types/mail'

type WizardReviewStepProps = {
  provider: MailboxProvider
  values: WizardValues
  onEditStep: (step: 'provider' | 'details') => void
}

const PROVIDER_LABELS: Record<MailboxProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook / Microsoft 365',
  zoho: 'Zoho Mail',
  custom: 'Generic SMTP / IMAP',
}

export function WizardReviewStep({ provider, values, onEditStep }: WizardReviewStepProps) {
  const isOAuth = provider !== 'custom'

  const maskPassword = (pw: string) => {
    if (!pw) return ''
    return '\u2022'.repeat(Math.min(pw.length, 8))
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Review Configuration</h2>
        <p className="text-sm text-muted-foreground">
          Verify your mailbox settings before testing the connection.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Mail className="h-4 w-4" aria-hidden="true" />
                Provider &amp; Mailbox
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEditStep('provider')}
                className="h-7 text-xs"
              >
                <Edit2 className="h-3 w-3 mr-1" aria-hidden="true" />
                Edit
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="font-medium text-foreground mt-0.5 flex items-center gap-2">
                  {PROVIDER_LABELS[provider]}
                  <Badge variant={isOAuth ? 'default' : 'secondary'} className="text-[10px]">
                    {isOAuth ? 'OAuth' : 'SMTP/IMAP'}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-foreground mt-0.5">{values.email || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Display Name</dt>
                <dd className="font-medium text-foreground mt-0.5">{values.displayName || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Sender Name</dt>
                <dd className="font-medium text-foreground mt-0.5">{values.senderName || '—'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Timezone</dt>
                <dd className="font-medium text-foreground mt-0.5">{values.timezone}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Daily Limit</dt>
                <dd className="font-medium text-foreground mt-0.5">{values.dailyLimit} emails/day</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </motion.div>

      {isOAuth && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
        >
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                  <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <div>
                  <h4 className="font-medium text-foreground">OAuth Authentication</h4>
                  <p className="text-sm text-muted-foreground mt-1">
                    You will be redirected to {PROVIDER_LABELS[provider]} to authorize access.
                    No passwords are stored. Tokens are encrypted at rest.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {!isOAuth && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="space-y-4"
        >
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Server className="h-4 w-4" aria-hidden="true" />
                  SMTP Settings
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEditStep('details')}
                  className="h-7 text-xs"
                >
                  <Edit2 className="h-3 w-3 mr-1" aria-hidden="true" />
                  Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Host</dt>
                  <dd className="font-medium text-foreground mt-0.5 font-mono text-xs">
                    {values.smtp.smtpHost || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Port</dt>
                  <dd className="font-medium text-foreground mt-0.5 font-mono text-xs">
                    {values.smtp.smtpPort || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Username</dt>
                  <dd className="font-medium text-foreground mt-0.5">{values.smtp.smtpUsername || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Password</dt>
                  <dd className="font-medium text-foreground mt-0.5">{maskPassword(values.smtp.smtpPassword) || '—'}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Encryption</dt>
                  <dd className="font-medium text-foreground mt-0.5 uppercase">{values.smtp.encryption}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Globe className="h-4 w-4" aria-hidden="true" />
                IMAP Settings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">Host</dt>
                  <dd className="font-medium text-foreground mt-0.5 font-mono text-xs">
                    {values.imap.imapHost || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Port</dt>
                  <dd className="font-medium text-foreground mt-0.5 font-mono text-xs">
                    {values.imap.imapPort || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">SSL</dt>
                  <dd className="font-medium text-foreground mt-0.5">{values.imap.imapSsl ? 'Enabled' : 'Disabled'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </motion.div>
      )}

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm">
              <h4 className="font-medium text-foreground">Before You Continue</h4>
              <ul className="mt-2 space-y-1 text-muted-foreground list-disc list-inside">
                <li>Ensure DNS records (SPF, DKIM, DMARC) are configured for your domain.</li>
                <li>Warmup is recommended for new mailboxes to build sender reputation.</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
