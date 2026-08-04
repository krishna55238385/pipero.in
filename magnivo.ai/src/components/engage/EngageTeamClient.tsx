'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EngageProductShell, EngageEmpty, EngageLoading } from '@/components/mail/EngageProductShell'
import { resolveMailPermissions } from '@/lib/mail-permissions'
import {
  listWorkspaceMembersAction,
  listOrgMembersForMailInviteAction,
  upsertWorkspaceMemberAction,
  removeWorkspaceMemberAction,
  getMailPermissionsAction,
} from '@/app/actions/mail'

const ROLES = ['viewer', 'member', 'manager', 'admin'] as const

export default function EngageTeamClient() {
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Awaited<ReturnType<typeof listWorkspaceMembersAction>>>([])
  const [orgMembers, setOrgMembers] = useState<Awaited<ReturnType<typeof listOrgMembersForMailInviteAction>>>([])
  const [canAdmin, setCanAdmin] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState<(typeof ROLES)[number]>('member')
  const [canLaunch, setCanLaunch] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matrix = ROLES.map((role) => ({
    role,
    perms: resolveMailPermissions(role),
  }))

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, o, p] = await Promise.all([
        listWorkspaceMembersAction(),
        listOrgMembersForMailInviteAction().catch(() => []),
        getMailPermissionsAction(),
      ])
      setMembers(m)
      setOrgMembers(o)
      setCanAdmin(p.canAdmin)
      if (!selectedUserId && o[0]) setSelectedUserId(o[0].userId)
    } catch {
      setError('Failed to load team')
    } finally {
      setLoading(false)
    }
  }, [selectedUserId])

  useEffect(() => {
    void load()
  }, [load])

  async function saveMember() {
    const org = orgMembers.find((x) => x.userId === selectedUserId)
    if (!org) {
      setError('Select a workspace user')
      return
    }
    setBusy(true)
    const result = await upsertWorkspaceMemberAction({
      userId: org.userId,
      email: org.email,
      mailRole: selectedRole,
      canLaunchCampaigns: canLaunch && selectedRole !== 'viewer',
    })
    setBusy(false)
    if (!result.success) {
      setError('error' in result ? String(result.error) : 'Failed to save')
      return
    }
    await load()
  }

  if (loading) {
    return (
      <EngageProductShell title="Team & Permissions" description="Assignable Engage roles for launch vs read-only">
        <EngageLoading />
      </EngageProductShell>
    )
  }

  return (
    <EngageProductShell
      title="Team & Permissions"
      description="Assign Engage mail roles per teammate. Overrides Magnivo org role for mail actions."
      stats={[
        { label: 'Assigned overrides', value: members.length },
        { label: 'Org members', value: orgMembers.length },
        { label: 'Viewer launch', value: 'No', tone: 'warn' },
      ]}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mail permission matrix</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Read</th>
                <th className="py-2 pr-3">Write</th>
                <th className="py-2 pr-3">Manage</th>
                <th className="py-2">Admin</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.role} className="border-b border-border/50">
                  <td className="py-2 pr-3 capitalize font-medium">{row.role}</td>
                  <td className="py-2 pr-3">{row.perms.canRead ? '✓' : '—'}</td>
                  <td className="py-2 pr-3">{row.perms.canWrite ? '✓' : '—'}</td>
                  <td className="py-2 pr-3">{row.perms.canManage ? '✓' : '—'}</td>
                  <td className="py-2">{row.perms.canAdmin ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Assignable roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canAdmin ? (
            <p className="text-sm text-muted-foreground">Only mail admins can assign Engage roles.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                aria-label="Workspace user"
              >
                {orgMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.email} ({m.role})
                  </option>
                ))}
              </select>
              <select
                className="h-9 rounded-md border bg-background px-3 text-sm"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as (typeof ROLES)[number])}
                aria-label="Mail role"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={canLaunch}
                  onChange={(e) => setCanLaunch(e.target.checked)}
                />
                Can launch campaigns
              </label>
              <Button disabled={busy || !selectedUserId} onClick={() => void saveMember()}>
                {busy ? 'Saving…' : 'Save role'}
              </Button>
            </div>
          )}

          {members.length === 0 ? (
            <EngageEmpty
              title="No role overrides yet"
              description="Assign a teammate a viewer/member/manager/admin Engage role. Until then, Magnivo org roles apply."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" aria-label="Assigned Engage roles">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2 pr-3">Email</th>
                    <th className="py-2 pr-3">Role</th>
                    <th className="py-2 pr-3">Launch</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-medium">{m.email}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline">{m.mailRole}</Badge>
                      </td>
                      <td className="py-2 pr-3">{m.canLaunchCampaigns ? 'Yes' : 'No'}</td>
                      <td className="py-2">
                        {canAdmin && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void removeWorkspaceMemberAction(m.userId).then(() => load())}
                          >
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </EngageProductShell>
  )
}
