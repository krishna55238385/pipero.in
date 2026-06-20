'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCompany, deleteCompany, updateCompany } from '@/app/actions/crm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Company</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
          </div>
          <div>
            <Label>Website</Label>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://company.com" />
          </div>
          <div>
            <Label>Industry</Label>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          </div>
          <div className="md:col-span-5">
            <Button onClick={onCreate} disabled={isPending}>Add Company</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Companies ({companies.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company ID</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>{company.name}</TableCell>
                  <TableCell>{company.website || '-'}</TableCell>
                  <TableCell>{company.industry || '-'}</TableCell>
                  <TableCell>{company.phone || '-'}</TableCell>
                  <TableCell>{company.email || '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{company.id}</TableCell>
                  <TableCell className="space-x-2">
                    <Button size="sm" variant="outline" onClick={() => onRename(company)}>Edit Name</Button>
                    <Button size="sm" variant="destructive" onClick={() => onDelete(company.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
