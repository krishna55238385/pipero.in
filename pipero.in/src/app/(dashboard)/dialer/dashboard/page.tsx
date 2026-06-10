import DialerDashboardClient from '@/components/dialer/DialerDashboardClient'

export default function DialerDashboardPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Dialer Dashboard</h1>
        <p className="text-sm text-muted-foreground">Call performance overview.</p>
      </div>
      <DialerDashboardClient />
    </div>
  )
}

