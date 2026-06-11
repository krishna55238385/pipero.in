'use client'

import { useState, useTransition } from 'react'
import { Eye, EyeOff, ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { connectSmtpAccount, testSmtpConnection } from '@/app/actions/engage'

type Security = 'tls' | 'ssl' | 'none'

const SECURITY_PORTS: Record<Security, number> = {
  tls: 587,
  ssl: 465,
  none: 25,
}

export default function SmtpConnectDialog() {
  const [open, setOpen] = useState(false)

  const [fromName, setFromName] = useState('')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState<number>(587)
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

  const handleSecurityChange = (value: Security) => {
    setSmtpSecurity(value)
    setSmtpPort(SECURITY_PORTS[value])
  }

  const handleTest = () => {
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

  const handleConnect = () => {
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
      } else {
        setOpen(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full">
          <ServerCog className="h-4 w-4 mr-2" />
          Configure SMTP
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect SMTP account</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label htmlFor="smtp-from-name">From name</Label>
            <Input
              id="smtp-from-name"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder="Your Name"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="smtp-host">SMTP host</Label>
            <Input
              id="smtp-host"
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="smtp.gmail.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="smtp-security">Security</Label>
              <Select value={smtpSecurity} onValueChange={(v) => handleSecurityChange(v as Security)}>
                <SelectTrigger id="smtp-security" className="w-full">
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
                placeholder="587"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="smtp-user">Username / email</Label>
            <Input
              id="smtp-user"
              type="text"
              value={smtpUser}
              onChange={(e) => setSmtpUser(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="smtp-pass">Password / app password</Label>
            <div className="relative">
              <Input
                id="smtp-pass"
                type={showPass ? 'text' : 'password'}
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder="••••••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="imap-host">
              IMAP host <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="imap-host"
              value={imapHost}
              onChange={(e) => setImapHost(e.target.value)}
              placeholder="imap.gmail.com"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="imap-port">
              IMAP port <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="imap-port"
              type="number"
              value={imapPort}
              onChange={(e) => setImapPort(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="993"
            />
          </div>

          {testStatus === 'ok' && (
            <p className="text-xs text-emerald-600">Connection successful</p>
          )}
          {testStatus === 'error' && (
            <p className="text-xs text-red-500">{testError}</p>
          )}
          {connectError && (
            <p className="text-xs text-red-500">{connectError}</p>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={isTesting || isConnecting}
          >
            {isTesting ? 'Testing...' : 'Test connection'}
          </Button>
          <Button
            type="button"
            onClick={handleConnect}
            disabled={isConnecting || isTesting}
          >
            {isConnecting ? 'Connecting...' : 'Connect'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
