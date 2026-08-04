'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { backfillContactsAndCompaniesFromLeads, createContact, deleteContact, updateContact } from '@/app/actions/crm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Users } from 'lucide-react'

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
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Contacts</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your contact database.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create Contact</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <Label className="text-xs font-medium text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Email</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Job title" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium text-muted-foreground">Company ID</Label>
            <Input value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="Optional UUID" className="mt-1" />
          </div>
          <div className="md:col-span-6 flex gap-2">
            <Button onClick={onCreate} disabled={isPending}>Add Contact</Button>
            <Button variant="outline" onClick={onBackfill} disabled={isPending}>Backfill From Leads</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Contacts ({contacts.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {contacts.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground">No contacts yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create your first contact above.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.title || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{c.companies?.name || c.company_id || '-'}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => {
                        const next = prompt('New name', c.name)
                        if (next && next.trim()) onUpdate(c, { name: next.trim() })
                      }}>Edit</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDelete(c.id)}>Delete</Button>
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
