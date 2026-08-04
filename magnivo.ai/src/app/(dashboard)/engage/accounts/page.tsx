import { Suspense } from 'react'
import { getEmailAccounts, getAccountTags, getMailPermissionsForClient } from '@/app/actions/engage'
import AccountsListClient from '@/components/engage/AccountsListClient'

export default async function EmailAccountsPage() {
  const [accounts, tags, permissions] = await Promise.all([
    getEmailAccounts().catch(() => []),
    getAccountTags().catch(() => []),
    getMailPermissionsForClient(),
  ])

  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading accounts…</div>}>
      <AccountsListClient
        initialAccounts={accounts}
        availableTags={tags}
        permissions={permissions}
      />
    </Suspense>
  )
}
