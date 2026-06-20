'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { backfillContactsAndCompaniesFromLeads, createContact, deleteContact, updateContact } from '@/app/actions/crm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type Contact = {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  title?: string | null
  company_id?: string | null
  companies?: { id: string; name: string } | null
}

type Company = { id: string; name: string }

export default function ContactsClient({ contacts, companies }: { contacts: Contact[]; companies: Company[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [title, setTitle] = useState('')
  const [companyId, setCompanyId] = useState('')

  const onCreate = () => {
    const fd = new FormData()
    fd.set('name', name)
    fd.set('email', email)
    fd.set('phone', phone)
    fd.set('title', title)
    fd.set('company_id', companyId)

    startTransition(async () => {
      const res = await createContact(fd)
      if ('error' in res) {
        alert(res.error)
        return
      }
      setName('')
      setEmail('')
      setPhone('')
      setTitle('')
      setCompanyId('')
      router.refresh()
    })
  }

  const onUpdate = (contact: Contact, updates: Record<string, unknown>) => {
    startTransition(async () => {
      const res = await updateContact(contact.id, updates)
      if ('error' in res) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  const onDelete = (contactId: string) => {
    if (!confirm('Delete this contact?')) return
    startTransition(async () => {
      const res = await deleteContact(contactId)
      if ('error' in res) {
        alert(res.error)
        return
      }
      router.refresh()
    })
  }

  const onBackfill = () => {
    if (!confirm('Backfill contacts and companies from existing leads?')) return
    startTransition(async () => {
      const res = await backfillContactsAndCompaniesFromLeads()
      if ('error' in res) {
        alert(res.error)
        return
      }
      alert(`Backfill complete. Updated leads: ${res.updatedLeads}, companies: ${res.createdCompanies}, contacts: ${res.createdContacts}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" />
          </div>
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" />
          </div>
          <div>
            <Label>Company ID (optional)</Label>
            <Input value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="Paste company UUID" />
          </div>
          <div className="md:col-span-6">
            <p className="text-xs text-muted-foreground">
              Tip: copy a Company ID from the Companies page to link this contact.
            </p>
          </div>
          <div className="md:col-span-6">
            <div className="flex gap-2">
              <Button onClick={onCreate} disabled={isPending}>Add Contact</Button>
              <Button variant="outline" onClick={onBackfill} disabled={isPending}>Backfill From Leads</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contacts ({contacts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.email || '-'}</TableCell>
                  <TableCell>{c.phone || '-'}</TableCell>
                  <TableCell>{c.title || '-'}</TableCell>
                  <TableCell>{c.companies?.name || c.company_id || '-'}</TableCell>
                  <TableCell className="space-x-2">
                    <Button size="sm" variant="outline" onClick={() => {
                      const next = prompt('New name', c.name)
                      if (next && next.trim()) onUpdate(c, { name: next.trim() })
                    }}>Edit Name</Button>
                    <Button size="sm" variant="destructive" onClick={() => onDelete(c.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {companies.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">Available companies: {companies.slice(0, 6).map((x) => x.name).join(', ')}{companies.length > 6 ? '...' : ''}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
