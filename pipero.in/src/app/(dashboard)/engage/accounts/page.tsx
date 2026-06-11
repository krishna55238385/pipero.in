import { getEmailAccounts, getAccountTags } from '@/app/actions/engage'
import AccountsListClient from '@/components/engage/AccountsListClient'

export default async function EmailAccountsPage() {
  const [accounts, tags] = await Promise.all([
    getEmailAccounts().catch(() => []),
    getAccountTags().catch(() => []),
  ])

  return <AccountsListClient initialAccounts={accounts} availableTags={tags} />
}
