'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ListPlus, Trash2, Users } from 'lucide-react'
import {
  listLeadListsAction,
  createLeadListAction,
  deleteLeadListAction,
  listLeadListMembersAction,
  addLeadsToListAction,
} from '@/app/actions/mail'

type LeadListsPanelProps = {
  availableLeadIds?: string[]
}

export function LeadListsPanel({ availableLeadIds = [] }: LeadListsPanelProps) {
  const [lists, setLists] = useState<Awaited<ReturnType<typeof listLeadListsAction>>['lists']>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [members, setMembers] = useState<Awaited<ReturnType<typeof listLeadListMembersAction>>['members']>([])
  const [memberTotal, setMemberTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadLists = useCallback(async () => {
    setError(null)
    const result = await listLeadListsAction({ search: search || undefined, page, pageSize: 20 })
    setLists(result.lists)
    setTotalPages(result.totalPages)
    if (!selectedListId && result.lists[0]) setSelectedListId(result.lists[0].id)
  }, [search, page, selectedListId])

  const loadMembers = useCallback(async () => {
    if (!selectedListId) {
      setMembers([])
      setMemberTotal(0)
      return
    }
    const result = await listLeadListMembersAction(selectedListId, { page: 1, pageSize: 50 })
    setMembers(result.members)
    setMemberTotal(result.total)
  }, [selectedListId])

  useEffect(() => {
    void loadLists()
  }, [loadLists])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  async function handleCreate() {
    const result = await createLeadListAction({ name, description })
    if (!result.success) {
      setError(('error' in result && result.error) || 'Create failed')
      return
    }
    setName('')
    setDescription('')
    setMessage('List created')
    await loadLists()
  }

  async function handleDelete(id: string) {
    const result = await deleteLeadListAction(id)
    if (!result.success) {
      setError(('error' in result && result.error) || 'Delete failed')
      return
    }
    if (selectedListId === id) setSelectedListId(null)
    await loadLists()
  }

  async function handleAddSelectedLeads() {
    if (!selectedListId || availableLeadIds.length === 0) return
    const result = await addLeadsToListAction(selectedListId, availableLeadIds)
    if (!result.success) {
      setError(('error' in result && result.error) || 'Add failed')
      return
    }
    setMessage(`Added ${result.data?.added ?? 0} lead(s) to list`)
    await loadLists()
    await loadMembers()
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ListPlus className="h-4 w-4" /> Create lead list
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2">
          <Input placeholder="List name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
            Create
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lists</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Search lists…"
              value={search}
              onChange={(e) => {
                setPage(1)
                setSearch(e.target.value)
              }}
            />
            {lists.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No lists yet</p>
            ) : (
              <div className="divide-y rounded-md border">
                {lists.map((list) => (
                  <button
                    key={list.id}
                    type="button"
                    className={`w-full text-left px-3 py-2 hover:bg-muted/50 ${selectedListId === list.id ? 'bg-muted' : ''}`}
                    onClick={() => setSelectedListId(list.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{list.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{list.description || '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{list.memberCount}</Badge>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleDelete(list.id)
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <span>
                Page {page} / {totalPages}
              </span>
              <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Members ({memberTotal})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              size="sm"
              variant="outline"
              disabled={!selectedListId || availableLeadIds.length === 0}
              onClick={() => void handleAddSelectedLeads()}
            >
              Add currently loaded leads to list
            </Button>
            {!selectedListId ? (
              <p className="text-sm text-muted-foreground">Select a list</p>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No members</p>
            ) : (
              <div className="divide-y rounded-md border max-h-80 overflow-auto">
                {members.map((m) => (
                  <div key={m.leadId} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{m.email}</p>
                      <p className="text-xs text-muted-foreground truncate">{m.name || '—'}</p>
                    </div>
                    <Badge variant="outline">{m.verifiedStatus}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
