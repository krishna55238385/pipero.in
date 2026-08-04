import { Suspense } from 'react'
import EngageAddAccountClient from '@/components/engage/EngageAddAccountClient'

export default function EngageAddAccountPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <EngageAddAccountClient />
    </Suspense>
  )
}
