import InboxClient from '@/components/engage/InboxClient'
import { getGmailMailbox } from '@/app/actions/engage'

export default async function EngageInboxPage() {
  let mailbox: { email?: string } | null = null
  try {
    mailbox = await getGmailMailbox()
  } catch {
    mailbox = null
  }
  return <InboxClient mailbox={mailbox} />
}

