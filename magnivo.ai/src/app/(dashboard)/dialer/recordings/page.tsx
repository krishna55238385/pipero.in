import RecordingsClient from '@/components/dialer/RecordingsClient'

export default function DialerRecordingsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Dialer Recordings</h1>
        <p className="text-sm text-muted-foreground">Browse call recordings.</p>
      </div>
      <RecordingsClient />
    </div>
  )
}

