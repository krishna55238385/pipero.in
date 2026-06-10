import { ProspectCompaniesClient } from '@/components/prospects/ProspectCompaniesClient'
import { getIcps, getProspectCompanies } from '@/app/actions/gtm'

export const dynamic = 'force-dynamic'

export default async function ProspectCompaniesPage() {
  const [companies, icps] = await Promise.all([getProspectCompanies({}), getIcps()])
  return <ProspectCompaniesClient initialCompanies={companies} icps={icps} />
}
