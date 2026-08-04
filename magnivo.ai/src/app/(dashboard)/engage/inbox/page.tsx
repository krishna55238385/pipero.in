import InboxClient from '@/components/engage/InboxClient'
import { getGmailMailbox } from '@/app/actions/engage'

export default async function EngageInboxPage() {
  let mailbox: { email?: string } | null = null
  try {
    const row = await getGmailMailbox()
    mailbox = row ? { email: String(row.email ?? '') } : null
  } catch {
    mailbox = null
  }
  return <InboxClient mailbox={mailbox} />
}

