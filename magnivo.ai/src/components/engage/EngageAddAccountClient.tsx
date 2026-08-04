'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Eye, EyeOff, Loader2, ServerCog } from 'lucide-react'
import { WizardProviderStep } from '@/components/mail/wizard/WizardProviderStep'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { connectSmtpAccount, testSmtpConnection } from '@/app/actions/engage'
import type { MailboxProvider } from '@/types/mail'

type Security = 'tls' | 'ssl' | 'none'

const SECURITY_PORTS: Record<Security, number> = {
  tls: 587,
  ssl: 465,
  none: 25,
}

export default function EngageAddAccountClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const oauthError = searchParams.get('error')

  const [provider, setProvider] = useState<MailboxProvider | null>(null)
  const [step, setStep] = useState<'provider' | 'connect'>('provider')
  const [startingOAuth, setStartingOAuth] = useState(false)

  // SMTP form
  const [fromName, setFromName] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(587)
  const [smtpUser, setSmtpUser] = useState('')
  const [smtpPass, setSmtpPass] = useState('')
  const [smtpSecurity, setSmtpSecurity] = useState<Security>('tls')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState<number | ''>('')
  const [showPass, setShowPass] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const [connectError, setConnectError] = useState('')
  const [isTesting, startTest] = useTransition()
  const [isConnecting, startConnect] = useTransition()

  const providerLabel = useMemo(() => {
    switch (provider) {
      case 'gmail':
        return 'Gmail'
      case 'outlook':
        return 'Outlook / Microsoft 365'
      case 'zoho':
        return 'Zoho Mail'
      case 'custom':
        return 'Generic SMTP / IMAP'
      default:
        return 'Email provider'
    }
  }, [provider])

  function continueWithProvider() {
    if (!provider) return
    setStep('connect')
  }

  function startOAuth() {
    if (!provider || provider === 'custom') return
    setStartingOAuth(true)
    const qs = new URLSearchParams({
      provider,
      returnTo: '/engage/accounts',
    })
    window.location.href = `/api/engage/oauth/start?${qs.toString()}`
  }

  function handleSecurityChange(value: Security) {
    setSmtpSecurity(value)
    setSmtpPort(SECURITY_PORTS[value])
  }

  function handleTest() {
    setTestStatus('idle')
    setTestError('')
    startTest(async () => {
      const result = await testSmtpConnection({
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
        smtpSecurity,
      })
      if (result.ok) {
        setTestStatus('ok')
      } else {
        setTestStatus('error')
        setTestError(result.error ?? 'Connection failed')
      }
    })
  }

  function handleConnectSmtp() {
    setConnectError('')
    startConnect(async () => {
      const result = await connectSmtpAccount({
        fromName,
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
        smtpSecurity,
        imapHost: imapHost || undefined,
        imapPort: imapPort !== '' ? imapPort : undefined,
      })
      if (result.error) {
        setConnectError(result.error)
        return
      }
      router.push('/engage/accounts?connected=smtp')
      router.refresh()
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-2"
            onClick={() => {
              if (step === 'connect') {
                setStep('provider')
                return
              }
              router.push('/engage/accounts')
            }}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Add email account</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose a provider, then connect with OAuth or SMTP/IMAP credentials.
          </p>
        </div>
      </div>

      {oauthError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Connection failed: {decodeURIComponent(oauthError)}
        </p>
      )}

      {step === 'provider' && (
        <div className="space-y-6">
          <WizardProviderStep selectedProvider={provider} onSelectProvider={setProvider} />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.push('/engage/accounts')}>
              Cancel
            </Button>
            <Button disabled={!provider} onClick={continueWithProvider}>
              Continue
            </Button>
          </div>
        </div>
      )}

      {step === 'connect' && provider && provider !== 'custom' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Connect {providerLabel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              You will authorize Magnivo with send + read scopes only. Tokens are stored encrypted when
              encryption is configured. After consent you return to Accounts.
            </p>
            <ul className="text-sm text-muted-foreground list-disc pl-5 space-y-1">
              <li>Send outbound campaign and warmup mail</li>
              <li>Read inbox for replies, bounces, and classification</li>
              <li>No mailbox password is collected for OAuth providers</li>
            </ul>
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('provider')}>
                Change provider
              </Button>
              <Button onClick={startOAuth} disabled={startingOAuth}>
                {startingOAuth ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    Redirecting…
                  </>
                ) : (
                  `Continue with ${providerLabel}`
                )}
              </Button>
              {(provider === 'zoho' || provider === 'gmail' || provider === 'outlook') && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    // SMTP/IMAP fallback with provider presets (PRD §6.1.04)
                    setProvider('custom')
                    if (provider === 'zoho') {
                      setSmtpHost('smtp.zoho.com')
                      setSmtpPort(587)
                      setSmtpSecurity('tls')
                      setImapHost('imap.zoho.com')
                      setImapPort(993)
                    } else if (provider === 'gmail') {
                      setSmtpHost('smtp.gmail.com')
                      setSmtpPort(587)
                      setSmtpSecurity('tls')
                      setImapHost('imap.gmail.com')
                      setImapPort(993)
                    } else {
                      setSmtpHost('smtp.office365.com')
                      setSmtpPort(587)
                      setSmtpSecurity('tls')
                      setImapHost('outlook.office365.com')
                      setImapPort(993)
                    }
                  }}
                >
                  Use SMTP / IMAP instead
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'connect' && provider === 'custom' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ServerCog className="h-4 w-4" />
              SMTP / IMAP connection
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="from-name">From name</Label>
              <Input id="from-name" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your Name" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtp-host">SMTP host</Label>
              <Input id="smtp-host" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Security</Label>
                <Select value={smtpSecurity} onValueChange={(v) => handleSecurityChange(v as Security)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tls">TLS (587)</SelectItem>
                    <SelectItem value="ssl">SSL (465)</SelectItem>
                    <SelectItem value="none">None (25)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="smtp-port">SMTP port</Label>
                <Input
                  id="smtp-port"
                  type="number"
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtp-user">Username / email</Label>
              <Input id="smtp-user" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="you@example.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtp-pass">Password / app password</Label>
              <div className="relative">
                <Input
                  id="smtp-pass"
                  type={showPass ? 'text' : 'password'}
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowPass((v) => !v)}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="imap-host">IMAP host (optional)</Label>
              <Input id="imap-host" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="imap-port">IMAP port (optional)</Label>
              <Input
                id="imap-port"
                type="number"
                value={imapPort}
                onChange={(e) => setImapPort(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="993"
              />
            </div>

            {testStatus === 'ok' && <p className="text-xs text-emerald-600">Connection successful</p>}
            {testStatus === 'error' && <p className="text-xs text-destructive">{testError}</p>}
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setStep('provider')}>
                Change provider
              </Button>
              <Button variant="outline" onClick={handleTest} disabled={isTesting || isConnecting}>
                {isTesting ? 'Testing…' : 'Test connection'}
              </Button>
              <Button onClick={handleConnectSmtp} disabled={isConnecting || isTesting}>
                {isConnecting ? 'Connecting…' : 'Connect account'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
