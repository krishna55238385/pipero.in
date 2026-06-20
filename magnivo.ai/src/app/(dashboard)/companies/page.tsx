import { getCompanies } from '@/app/actions/crm'
import CompaniesClient from '@/components/crm/CompaniesClient'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams
  const q = params.q?.trim() || ''
  const companies = await getCompanies({ q })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Companies</h1>
        <p className="text-sm text-muted-foreground">Manage company accounts and map contacts/deals to them.</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <form className="flex gap-2">
            <Input name="q" defaultValue={q} placeholder="Search companies by name, email, or phone" />
          </form>
        </CardContent>
      </Card>

      <CompaniesClient companies={companies as any[]} />
    </div>
  )
}
