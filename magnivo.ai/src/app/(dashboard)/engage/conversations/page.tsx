import ConversationsClient from '@/components/engage/ConversationsClient'
import { getConversations, getEmailConversations } from '@/app/actions/engage'
import type { ConversationThread } from '@/types/engage'

export default async function EngageConversationsPage() {
  let conversations: ConversationThread[] = []
  try {
    // WhatsApp threads + email-reply threads, newest customer activity first.
    const [wa, email] = await Promise.all([getConversations(), getEmailConversations()])
    conversations = [...wa, ...email].sort((a, b) => {
      const ta = new Date(a.lastCustomerMessageAt || a.createdAt).getTime()
      const tb = new Date(b.lastCustomerMessageAt || b.createdAt).getTime()
      return tb - ta
    })
  } catch {
    conversations = []
  }
  return <ConversationsClient conversations={conversations} />
}
