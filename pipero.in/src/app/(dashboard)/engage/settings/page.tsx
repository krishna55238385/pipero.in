import EngageSettingsClient from '@/components/engage/EngageSettingsClient'
import {
  getGtmSchedule,
  getIcpOptions,
  getMailboxSyncStatus,
  getUnsubscribes,
} from '@/app/actions/engage'
import type { GtmScheduleConfig, UnsubscribeRow } from '@/types/engage'

export default async function EngageSettingsPage() {
  let status: { email: string; lastSyncedAt: string | null; watchExpiration: string | null; historyId: string | null } | null = null
  try {
    status = await getMailboxSyncStatus()
  } catch {
    status = null
  }

  let unsubscribes: UnsubscribeRow[] = []
  try {
    unsubscribes = await getUnsubscribes()
  } catch {
    unsubscribes = []
  }

  let schedule: GtmScheduleConfig | null = null
  let icpOptions: Awaited<ReturnType<typeof getIcpOptions>> = []
  try {
    ;[schedule, icpOptions] = await Promise.all([getGtmSchedule(), getIcpOptions()])
  } catch {
    schedule = null
    icpOptions = []
  }

  return (
    <EngageSettingsClient
      mailboxEmail={status?.email || null}
      lastSyncedAt={status?.lastSyncedAt || null}
      watchExpiration={status?.watchExpiration || null}
      historyId={status?.historyId || null}
      unsubscribes={unsubscribes}
      schedule={schedule}
      icpOptions={icpOptions}
    />
  )
}
