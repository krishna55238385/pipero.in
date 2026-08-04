'use client'

import { motion } from 'framer-motion'
import { ProviderCard } from '@/components/mail/wizard/ProviderCard'
import type { MailboxProvider, ProviderInfo } from '@/types/mail'

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Connect your Google Workspace or personal Gmail account via OAuth for secure, passwordless authentication.',
    authType: 'oauth',
    icon: 'mail',
  },
  {
    id: 'outlook',
    name: 'Outlook / Microsoft 365',
    description: 'Connect your Microsoft 365 or Outlook account via OAuth for secure, passwordless authentication.',
    authType: 'oauth',
    icon: 'building',
  },
  {
    id: 'zoho',
    name: 'Zoho Mail',
    description: 'Connect your Zoho Mail account via OAuth for secure, passwordless authentication.',
    authType: 'oauth',
    icon: 'mail',
  },
  {
    id: 'custom',
    name: 'Generic SMTP / IMAP',
    description: 'Configure any SMTP and IMAP server manually. Ideal for custom or self-hosted email providers.',
    authType: 'smtp_imap',
    icon: 'server',
  },
]

type WizardProviderStepProps = {
  selectedProvider: MailboxProvider | null
  onSelectProvider: (provider: MailboxProvider) => void
}

export function WizardProviderStep({ selectedProvider, onSelectProvider }: WizardProviderStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold text-foreground">Select Email Provider</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Choose your email provider to configure the connection. OAuth providers use secure, passwordless authentication.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto">
        {PROVIDERS.map((provider, index) => (
          <motion.div
            key={provider.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.3, ease: 'easeOut' }}
          >
            <ProviderCard
              provider={provider}
              isSelected={selectedProvider === provider.id}
              onSelect={() => onSelectProvider(provider.id)}
            />
          </motion.div>
        ))}
      </div>
    </div>
  )
}
