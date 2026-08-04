'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Mail, Shield, Info } from 'lucide-react'
import type { MailboxProvider, WizardValues, WizardSMTPValues, WizardIMAPValues } from '@/types/mail'
import {
  validateCreateMailboxRequest,
  validateSMTPConfig,
  validateIMAPConfig,
} from '@/lib/mail-validation'
import { AppPasswordGuide } from '@/components/mail/wizard/AppPasswordGuide'

type WizardConnectionStepProps = {
  provider: MailboxProvider
  values: WizardValues
  onValuesChange: (values: Partial<WizardValues>) => void
  onSMTPChange: (values: Partial<WizardSMTPValues>) => void
  onIMAPChange: (values: Partial<WizardIMAPValues>) => void
  onValidation: (errors: string[]) => void
}

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Kolkata',
  'Australia/Sydney',
]

const ENCRYPTION_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
]

export function WizardConnectionStep({
  provider,
  values,
  onValuesChange,
  onSMTPChange,
  onIMAPChange,
  onValidation,
}: WizardConnectionStepProps) {
  const isOAuth = provider !== 'custom'
  const lastErrorsRef = useRef('')

  const mailboxValidation = useMemo(
    () =>
      validateCreateMailboxRequest({
        email: values.email,
        provider,
        authType: isOAuth ? 'oauth' : 'smtp',
        timezone: values.timezone,
        dailyLimit: values.dailyLimit,
      }),
    [values.email, provider, isOAuth, values.timezone, values.dailyLimit]
  )

  const smtpValidation = useMemo(() => {
    if (isOAuth) return { valid: true, errors: [] }
    return validateSMTPConfig({
      smtpHost: values.smtp.smtpHost,
      smtpPort: Number(values.smtp.smtpPort) || 0,
      username: values.smtp.smtpUsername,
      encryptedPasswordReference: values.smtp.smtpPassword,
      encryption: values.smtp.encryption,
    })
  }, [isOAuth, values.smtp])

  const imapValidation = useMemo(() => {
    if (isOAuth) return { valid: true, errors: [] }
    return validateIMAPConfig({
      host: values.imap.imapHost,
      port: Number(values.imap.imapPort) || 0,
      authentication: 'password',
    })
  }, [isOAuth, values.imap])

  useEffect(() => {
    const allErrors = [
      ...mailboxValidation.errors,
      ...smtpValidation.errors,
      ...imapValidation.errors,
    ]
    const serialized = JSON.stringify(allErrors)
    if (serialized !== lastErrorsRef.current) {
      lastErrorsRef.current = serialized
      onValidation(allErrors)
    }
  }, [mailboxValidation.errors, smtpValidation.errors, imapValidation.errors, onValidation])

  const fieldClass =
    'bg-background border-border/60 focus:border-primary focus:ring-primary/20'
  const labelClass = 'text-sm font-medium text-foreground'

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Connection Details</h2>
        <p className="text-sm text-muted-foreground">
          {isOAuth
            ? 'Enter your mailbox details. Authentication is handled securely via OAuth.'
            : 'Configure your SMTP and IMAP server settings.'}
        </p>
      </div>

      {!isOAuth && <AppPasswordGuide provider={provider} />}
      {isOAuth && <AppPasswordGuide provider={provider} />}

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="h-4 w-4" aria-hidden="true" />
            Mailbox Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email" className={labelClass}>
                Email Address <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={values.email}
                onChange={(e) => onValuesChange({ email: e.target.value })}
                className={fieldClass}
                aria-required="true"
                aria-invalid={!mailboxValidation.valid && values.email.length > 0}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone" className={labelClass}>Timezone</Label>
              <select
                id="timezone"
                value={values.timezone}
                onChange={(e) => onValuesChange({ timezone: e.target.value })}
                className={`flex h-9 w-full rounded-md border px-3 text-sm ${fieldClass}`}
                aria-label="Select timezone"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>{tz}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="displayName" className={labelClass}>Display Name</Label>
              <Input
                id="displayName"
                placeholder="My Mailbox"
                value={values.displayName}
                onChange={(e) => onValuesChange({ displayName: e.target.value })}
                className={fieldClass}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="senderName" className={labelClass}>Sender Name</Label>
              <Input
                id="senderName"
                placeholder="John Doe"
                value={values.senderName}
                onChange={(e) => onValuesChange({ senderName: e.target.value })}
                className={fieldClass}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {isOAuth && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                <Shield className="h-5 w-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <h4 className="font-medium text-foreground">OAuth Authentication</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  This provider uses OAuth authentication. You will be redirected to{' '}
                  <span className="font-medium text-foreground">{provider.charAt(0).toUpperCase() + provider.slice(1)}</span>
                  {' '}to authorize access. No passwords are stored.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isOAuth && (
        <>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="h-4 w-4" aria-hidden="true" />
                SMTP Settings
                <Badge variant="secondary" className="text-[10px]">Required</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtpHost" className={labelClass}>
                    SMTP Host <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="smtpHost"
                    placeholder="smtp.example.com"
                    value={values.smtp.smtpHost}
                    onChange={(e) => onSMTPChange({ smtpHost: e.target.value })}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtpPort" className={labelClass}>
                    SMTP Port <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="smtpPort"
                    type="number"
                    placeholder="587"
                    value={values.smtp.smtpPort}
                    onChange={(e) => onSMTPChange({ smtpPort: e.target.value })}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="smtpUsername" className={labelClass}>
                    Username <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="smtpUsername"
                    placeholder="user@example.com"
                    value={values.smtp.smtpUsername}
                    onChange={(e) => onSMTPChange({ smtpUsername: e.target.value })}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtpPassword" className={labelClass}>
                    Password <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="smtpPassword"
                    type="password"
                    placeholder="••••••••"
                    value={values.smtp.smtpPassword}
                    onChange={(e) => onSMTPChange({ smtpPassword: e.target.value })}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="encryption" className={labelClass}>Encryption</Label>
                  <select
                    id="encryption"
                    value={values.smtp.encryption}
                    onChange={(e) => onSMTPChange({ encryption: e.target.value as 'none' | 'ssl' | 'starttls' })}
                    className={`flex h-9 w-full rounded-md border px-3 text-sm ${fieldClass}`}
                  >
                    {ENCRYPTION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="authType" className={labelClass}>Authentication Type</Label>
                  <select
                    id="authType"
                    value={values.smtp.authenticationType}
                    onChange={(e) => onSMTPChange({ authenticationType: e.target.value as 'password' | 'oauth2' | 'ntlm' })}
                    className={`flex h-9 w-full rounded-md border px-3 text-sm ${fieldClass}`}
                  >
                    <option value="password">Password</option>
                    <option value="oauth2">OAuth2</option>
                    <option value="ntlm">NTLM</option>
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="h-4 w-4" aria-hidden="true" />
                IMAP Settings
                <Badge variant="outline" className="text-[10px]">Optional</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="imapHost" className={labelClass}>IMAP Host</Label>
                  <Input
                    id="imapHost"
                    placeholder="imap.example.com"
                    value={values.imap.imapHost}
                    onChange={(e) => onIMAPChange({ imapHost: e.target.value })}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="imapPort" className={labelClass}>IMAP Port</Label>
                  <Input
                    id="imapPort"
                    type="number"
                    placeholder="993"
                    value={values.imap.imapPort}
                    onChange={(e) => onIMAPChange({ imapPort: e.target.value })}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="imapUsername" className={labelClass}>IMAP Username</Label>
                  <Input
                    id="imapUsername"
                    placeholder="user@example.com"
                    value={values.imap.imapUsername}
                    onChange={(e) => onIMAPChange({ imapUsername: e.target.value })}
                    className={fieldClass}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="imapPassword" className={labelClass}>IMAP Password</Label>
                  <Input
                    id="imapPassword"
                    type="password"
                    placeholder="••••••••"
                    value={values.imap.imapPassword}
                    onChange={(e) => onIMAPChange({ imapPassword: e.target.value })}
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch
                  id="imapSsl"
                  checked={values.imap.imapSsl}
                  onCheckedChange={(checked) => onIMAPChange({ imapSsl: checked })}
                  aria-label="Enable SSL for IMAP"
                />
                <Label htmlFor="imapSsl" className="text-sm font-medium cursor-pointer">
                  SSL Encryption
                </Label>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
