import { getCompanies, getContacts, getCustomers, getLeads } from '@/app/actions/crm'
import CustomersClient from '@/components/crm/CustomersClient'

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const params = await searchParams
  const q = params.q?.trim() || ''

  const [customers, companies, contacts, leadsResp] = await Promise.all([
    getCustomers({ q }),
    getCompanies(),
    getContacts(),
    getLeads(),
  ])

  const leads = Array.isArray(leadsResp) ? leadsResp : (leadsResp?.data || [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-muted-foreground">Track converted leads as active customers.</p>
      </div>
      <CustomersClient
        customers={customers as any[]}
        companies={companies as any[]}
        contacts={contacts as any[]}
        leads={leads as any[]}
      />
    </div>
  )
}
