'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addListMember, createList, deleteList, removeListMember } from '@/app/actions/crm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type ListItem = { id: string; name: string; description?: string | null; list_members?: { count?: number }[] }
type Member = { id: string; list_id: string; member_type: string; member_id: string }

export default function ListsClient({ lists, members }: { lists: ListItem[]; members: Member[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [activeListId, setActiveListId] = useState<string>(lists[0]?.id || '')

  const onCreateList = (form: HTMLFormElement) => {
    const fd = new FormData(form)
    startTransition(async () => {
      const res = await createList(fd)
      if ('error' in res) return alert(res.error)
      form.reset()
      router.refresh()
    })
  }

  const onDeleteList = (id: string) => {
    if (!confirm('Delete this list and its members?')) return
    startTransition(async () => {
      const res = await deleteList(id)
      if ('error' in res) return alert(res.error)
      router.refresh()
    })
  }

  const onAddMember = (form: HTMLFormElement) => {
    const fd = new FormData(form)
    startTransition(async () => {
      const res = await addListMember(fd)
      if ('error' in res) return alert(res.error)
      form.reset()
      router.refresh()
    })
  }

  const onRemoveMember = (id: string) => {
    startTransition(async () => {
      const res = await removeListMember(id)
      if ('error' in res) return alert(res.error)
      router.refresh()
    })
  }

  const filtered = members.filter((m) => !activeListId || m.list_id === activeListId)

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create List</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-3" onSubmit={(e) => { e.preventDefault(); onCreateList(e.currentTarget) }}>
            <div>
              <Label>Name</Label>
              <Input name="name" placeholder="List name" />
            </div>
            <div className="md:col-span-2">
              <Label>Description</Label>
              <Input name="description" placeholder="Optional description" />
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={isPending}>Create List</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Lists ({lists.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>List ID</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell>{l.description || '-'}</TableCell>
                  <TableCell>{l.list_members?.[0]?.count || 0}</TableCell>
                  <TableCell className="font-mono text-xs">{l.id}</TableCell>
                  <TableCell className="space-x-2">
                    <Button size="sm" variant="outline" onClick={() => setActiveListId(l.id)}>View Members</Button>
                    <Button size="sm" variant="destructive" onClick={() => onDeleteList(l.id)}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add List Member</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-4 gap-3" onSubmit={(e) => { e.preventDefault(); onAddMember(e.currentTarget) }}>
            <div>
              <Label>List ID</Label>
              <Input name="list_id" defaultValue={activeListId} placeholder="List UUID" />
            </div>
            <div>
              <Label>Member Type</Label>
              <Input name="member_type" placeholder="contact/lead/company/customer" />
            </div>
            <div>
              <Label>Member ID</Label>
              <Input name="member_id" placeholder="Entity UUID" />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={isPending}>Add Member</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>List Members {activeListId ? `(List: ${activeListId})` : ''}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Member ID</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.member_type}</TableCell>
                  <TableCell className="font-mono text-xs">{m.member_id}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="destructive" onClick={() => onRemoveMember(m.id)}>Remove</Button>
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
