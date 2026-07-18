'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCompany, deleteCompany, updateCompany } from '@/app/actions/crm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Building2 } from 'lucide-react'

type Company = {
  id: string
  name: string
  website?: string | null
  industry?: string | null
  phone?: string | null
  email?: string | null
}

export default function CompaniesClient({ companies }: { companies: Company[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [industry, setIndustry] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')

  const onCreate = () => {
    const fd = new FormData()
    fd.set('name', name)
    fd.set('website', website)
    fd.set('industry', industry)
    fd.set('phone', phone)
    fd.set('email', email)

    startTransition(async () => {
      const res = await createCompany(fd)
      if ('error' in res) {
        alert(res.error)
        return
      }
      setName('')
      setWebsite('')
      setIndustry('')
      setPhone('')
      setEmail('')
      router.refresh()
    })
  }

  const onDelete = (companyId: string) => {
    if (!confirm('Delete this company?')) return
    startTransition(async () => {
      const res = await deleteCompany(companyId)
      if ('error' in res) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  const onRename = (company: Company) => {
    const next = prompt('New company name', company.name)
    if (!next || !next.trim()) return
    startTransition(async () => {
      const res = await updateCompany(company.id, { name: next.trim() })
      if ('error' in res) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Companies</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your company directory.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Company</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Website</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://company.com" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Industry</Label>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="mt-1" />
          </div>
          <div className="md:col-span-5">
            <Button onClick={onCreate} disabled={isPending}>Add Company</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Companies ({companies.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {companies.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground">No companies yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create your first company above.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => (
                  <TableRow key={company.id}>
                    <TableCell className="font-medium">{company.name}</TableCell>
                    <TableCell className="text-muted-foreground">{company.website || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{company.industry || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{company.phone || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{company.email || '-'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => onRename(company)}>Edit</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(company.id)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
