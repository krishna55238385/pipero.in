'use client'

import WarmupDashboardClient from '@/components/mail/warmup/WarmupDashboardClient'

type MailWarmupClientProps = {
  isLoading?: boolean
}

export default function MailWarmupClient({ isLoading = false }: MailWarmupClientProps) {
  return <WarmupDashboardClient isLoading={isLoading} />
}
