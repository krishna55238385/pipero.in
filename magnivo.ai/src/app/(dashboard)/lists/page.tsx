import { getListMembers, getLists } from '@/app/actions/crm'
import ListsClient from '@/components/crm/ListsClient'

export default async function ListsPage() {
  const lists = await getLists()
  const memberGroups = await Promise.all((lists || []).map((l: any) => getListMembers(l.id)))
  const members = memberGroups.flat()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Lists</h1>
        <p className="text-sm text-muted-foreground">Build manual CRM segments for contacts, leads, companies, and customers.</p>
      </div>
      <ListsClient lists={lists as any[]} members={members as any[]} />
    </div>
  )
}
