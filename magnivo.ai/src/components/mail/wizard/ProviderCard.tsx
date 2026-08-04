'use client'

import { motion } from 'framer-motion'
import { Mail, Globe, Building2, Server } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ProviderInfo } from '@/types/mail'

type ProviderCardProps = {
  provider: ProviderInfo
  isSelected: boolean
  onSelect: () => void
}

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  gmail: Mail,
  outlook: Building2,
  zoho: Mail,
  custom: Server,
}

export function ProviderCard({ provider, isSelected, onSelect }: ProviderCardProps) {
  const Icon = PROVIDER_ICONS[provider.id] || Globe

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative w-full text-left rounded-xl border p-5 transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        isSelected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border/60 bg-card hover:border-border hover:bg-accent/30'
      )}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.98 }}
      aria-pressed={isSelected}
      aria-label={`Select ${provider.name} as mailbox provider`}
    >
      {isSelected && (
        <motion.div
          className="absolute inset-0 rounded-xl border-2 border-primary pointer-events-none"
          layoutId="provider-ring"
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}

      <div className="flex items-start gap-4">
        <div
          className={cn(
            'flex h-12 w-12 items-center justify-center rounded-lg transition-colors shrink-0',
            isSelected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          )}
        >
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-foreground">{provider.name}</h3>
            <Badge
              variant={provider.authType === 'oauth' ? 'default' : 'secondary'}
              className="text-[10px] px-1.5 py-0"
            >
              {provider.authType === 'oauth' ? 'OAuth' : 'SMTP/IMAP'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground line-clamp-2">{provider.description}</p>
        </div>

        <div
          className={cn(
            'h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 transition-colors',
            isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
          )}
          aria-hidden="true"
        >
          {isSelected && (
            <motion.div
              className="h-2 w-2 rounded-full bg-primary-foreground"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            />
          )}
        </div>
      </div>
    </motion.button>
  )
}
