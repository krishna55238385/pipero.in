import { getCompanies, getContacts } from '@/app/actions/crm'
import ContactsClient from '@/components/crm/ContactsClient'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams
  const q = params.q?.trim() || ''

  const [contacts, companies] = await Promise.all([
    getContacts({ q }),
    getCompanies(),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="text-sm text-muted-foreground">Manage all people records in your CRM.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form className="flex gap-2">
            <Input name="q" defaultValue={q} placeholder="Search contacts by name, email, or phone" />
          </form>
        </CardContent>
      </Card>

      <ContactsClient contacts={contacts as any[]} companies={companies as any[]} />
    </div>
  )
}
