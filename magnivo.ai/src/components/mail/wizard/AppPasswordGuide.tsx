'use client'

import { ExternalLink, KeyRound } from 'lucide-react'
import type { MailboxProvider } from '@/types/mail'

const GUIDES: Record<
  MailboxProvider,
  { title: string; steps: string[]; docsUrl: string; visual: 'google' | 'microsoft' | 'zoho' | 'generic' }
> = {
  gmail: {
    title: 'Gmail app password (SMTP/IMAP fallback)',
    steps: [
      'Enable 2-Step Verification on the Google Account.',
      'Open Google Account → Security → App passwords.',
      'Create an app password for “Mail” and copy the 16-character password.',
      'Use smtp.gmail.com:587 (STARTTLS) and imap.gmail.com:993 (SSL).',
      'Prefer OAuth when possible — app passwords are only for SMTP/IMAP mode.',
    ],
    docsUrl: 'https://support.google.com/accounts/answer/185833',
    visual: 'google',
  },
  outlook: {
    title: 'Microsoft 365 / Outlook app password',
    steps: [
      'Sign in to account.microsoft.com → Security → Advanced security options.',
      'Under App passwords, create a new app password (requires MFA).',
      'SMTP: smtp.office365.com:587 STARTTLS; IMAP: outlook.office365.com:993 SSL.',
      'Prefer Microsoft OAuth for production mailboxes.',
    ],
    docsUrl:
      'https://support.microsoft.com/account-billing/using-app-passwords-with-apps-that-don-t-support-two-step-verification',
    visual: 'microsoft',
  },
  zoho: {
    title: 'Zoho Mail app-specific password',
    steps: [
      'Open Zoho Account → Security → App Passwords.',
      'Generate a password for SMTP/IMAP clients.',
      'SMTP: smtp.zoho.com:587 STARTTLS; IMAP: imap.zoho.com:993 SSL.',
      'Prefer Zoho OAuth for production mailboxes.',
    ],
    docsUrl: 'https://www.zoho.com/mail/help/adminconsole/two-factor-authentication.html#alink5',
    visual: 'zoho',
  },
  custom: {
    title: 'Generic SMTP / IMAP',
    steps: [
      'Obtain SMTP host, port, and encryption from your provider.',
      'Obtain IMAP host/port for bounce and reply detection.',
      'Use an app-specific password when the provider requires MFA.',
      'Run “Test connection” before saving — Magnivo sends a test email and verifies INBOX read.',
    ],
    docsUrl: 'https://www.rfc-editor.org/rfc/rfc5321',
    visual: 'generic',
  },
}

function GuideVisual({ kind }: { kind: 'google' | 'microsoft' | 'zoho' | 'generic' }) {
  const labels =
    kind === 'google'
      ? ['Google Account', 'Security', 'App passwords', 'Copy 16-char key']
      : kind === 'microsoft'
        ? ['Microsoft account', 'Security', 'App passwords', 'Create password']
        : kind === 'zoho'
          ? ['Zoho Account', 'Security', 'App Passwords', 'Generate']
          : ['Provider console', 'SMTP settings', 'IMAP settings', 'App password']

  return (
    <div
      className="rounded-md border bg-background p-3"
      role="img"
      aria-label={`Illustrated steps: ${labels.join(' → ')}`}
    >
      <svg viewBox="0 0 640 120" className="h-auto w-full text-foreground" aria-hidden="true">
        {labels.map((label, i) => {
          const x = 20 + i * 155
          return (
            <g key={label}>
              <rect
                x={x}
                y={28}
                width={130}
                height={64}
                rx={10}
                className="fill-muted stroke-border"
                strokeWidth={1.5}
              />
              <text
                x={x + 65}
                y={64}
                textAnchor="middle"
                className="fill-foreground"
                style={{ fontSize: 11, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}
              >
                {label}
              </text>
              {i < labels.length - 1 ? (
                <path
                  d={`M ${x + 134} 60 L ${x + 150} 60`}
                  className="stroke-muted-foreground"
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                />
              ) : null}
            </g>
          )
        })}
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" className="fill-muted-foreground" />
          </marker>
        </defs>
      </svg>
    </div>
  )
}

export function AppPasswordGuide({ provider }: { provider: MailboxProvider }) {
  const guide = GUIDES[provider]
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <KeyRound className="h-4 w-4" />
        {guide.title}
      </div>
      <GuideVisual kind={guide.visual} />
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <a
        href={guide.docsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        Provider documentation <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}
