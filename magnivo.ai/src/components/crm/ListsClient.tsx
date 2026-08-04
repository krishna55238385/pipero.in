'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addListMember, createList, deleteList, removeListMember } from '@/app/actions/crm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { List } from 'lucide-react'

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
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Lists</h1>
        <p className="text-sm text-muted-foreground mt-1">Organize your contacts into lists.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create List</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-3 gap-3" onSubmit={(e) => { e.preventDefault(); onCreateList(e.currentTarget) }}>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">Name</Label>
              <Input name="name" placeholder="List name" className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs font-medium text-muted-foreground">Description</Label>
              <Input name="description" placeholder="Optional description" className="mt-1" />
            </div>
            <div className="md:col-span-3">
              <Button type="submit" disabled={isPending}>Create List</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Lists ({lists.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {lists.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center mx-auto mb-3">
                <List className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground">No lists yet</p>
              <p className="text-xs text-muted-foreground mt-1">Create your first list above.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lists.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.name}</TableCell>
                    <TableCell className="text-muted-foreground">{l.description || '-'}</TableCell>
                    <TableCell className="text-muted-foreground">{l.list_members?.[0]?.count || 0}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => setActiveListId(l.id)}>View</Button>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onDeleteList(l.id)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {lists.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add List Member</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid grid-cols-1 md:grid-cols-4 gap-3" onSubmit={(e) => { e.preventDefault(); onAddMember(e.currentTarget) }}>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">List ID</Label>
                <Input name="list_id" defaultValue={activeListId} placeholder="List UUID" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Member Type</Label>
                <Input name="member_type" placeholder="contact/lead/company" className="mt-1" />
              </div>
              <div>
                <Label className="text-xs font-medium text-muted-foreground">Member ID</Label>
                <Input name="member_id" placeholder="Entity UUID" className="mt-1" />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={isPending}>Add Member</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {lists.length > 0 && filtered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">List Members ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Member ID</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.member_type}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{m.member_id}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onRemoveMember(m.id)}>Remove</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
