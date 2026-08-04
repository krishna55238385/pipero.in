import MailMailboxesClient from '@/components/mail/MailMailboxesClient'
import { getSessionUser } from '@/lib/auth'
import { resolveMailPermissions } from '@/lib/mail-permissions'

export default async function MailMailboxesPage() {
  const session = await getSessionUser()
  const permissions = resolveMailPermissions(session?.role || 'viewer')

  return <MailMailboxesClient userPermissions={permissions} />
}
