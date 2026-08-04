import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'
import { resolveMailPermissions } from '@/lib/mail-permissions'
import type { MailUserPermissions } from '@/types/mail'

export type MailWorkspaceRole = 'viewer' | 'member' | 'manager' | 'admin'

export type WorkspaceMember = {
  id: string
  organizationId: string
  userId: string
  email: string
  displayName: string | null
  mailRole: MailWorkspaceRole
  canLaunchCampaigns: boolean
  createdAt: string
  updatedAt: string
}

export type WorkspaceLifecycle = {
  organizationId: string
  status: 'active' | 'grace' | 'suspended' | 'pending_delete'
  graceEndsAt: string | null
  scheduledPurgeAt: string | null
  reason: string | null
  updatedAt: string
}

export type AuditEvent = {
  id: string
  organizationId: string
  actorUserId: string | null
  actorEmail: string | null
  entityType: string
  entityId: string | null
  action: string
  summary: string
  metadata: Record<string, unknown>
  createdAt: string
}

function mapMember(row: Record<string, unknown>): WorkspaceMember {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    userId: String(row.user_id),
    email: String(row.email),
    displayName: row.display_name ? String(row.display_name) : null,
    mailRole: row.mail_role as MailWorkspaceRole,
    canLaunchCampaigns: Boolean(row.can_launch_campaigns),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapLifecycle(row: Record<string, unknown>): WorkspaceLifecycle {
  return {
    organizationId: String(row.organization_id),
    status: row.status as WorkspaceLifecycle['status'],
    graceEndsAt: row.grace_ends_at ? String(row.grace_ends_at) : null,
    scheduledPurgeAt: row.scheduled_purge_at ? String(row.scheduled_purge_at) : null,
    reason: row.reason ? String(row.reason) : null,
    updatedAt: String(row.updated_at),
  }
}

function mapAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    entityType: String(row.entity_type),
    entityId: row.entity_id ? String(row.entity_id) : null,
    action: String(row.action),
    summary: String(row.summary || ''),
    metadata: (row.metadata as Record<string, unknown>) || {},
    createdAt: String(row.created_at),
  }
}

/** Assert a resource belongs to org — used by tenancy tests and services. */
export function assertOrgMatch(
  resourceOrgId: string | null | undefined,
  requestOrgId: string
): boolean {
  return Boolean(resourceOrgId && resourceOrgId === requestOrgId)
}

export async function listWorkspaceMembers(orgId: string): Promise<WorkspaceMember[]> {
  const result = await pool
    .query(
      `SELECT * FROM public.mail_workspace_members
       WHERE organization_id = $1
       ORDER BY email ASC`,
      [orgId]
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }))
  return result.rows.map(mapMember)
}

export async function upsertWorkspaceMember(input: {
  organizationId: string
  userId: string
  email: string
  displayName?: string
  mailRole: MailWorkspaceRole
  canLaunchCampaigns?: boolean
  invitedBy?: string
}): Promise<MailApiResult<WorkspaceMember>> {
  try {
    const result = await pool.query(
      `INSERT INTO public.mail_workspace_members
        (organization_id, user_id, email, display_name, mail_role, can_launch_campaigns, invited_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id, user_id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = COALESCE(EXCLUDED.display_name, mail_workspace_members.display_name),
         mail_role = EXCLUDED.mail_role,
         can_launch_campaigns = EXCLUDED.can_launch_campaigns,
         updated_at = NOW()
       RETURNING *`,
      [
        input.organizationId,
        input.userId,
        input.email.toLowerCase().trim(),
        input.displayName ?? null,
        input.mailRole,
        input.canLaunchCampaigns ?? input.mailRole !== 'viewer',
        input.invitedBy ?? null,
      ]
    )
    await recordAuditEvent({
      organizationId: input.organizationId,
      actorUserId: input.invitedBy ?? null,
      entityType: 'workspace_member',
      entityId: input.userId,
      action: 'member_role_upsert',
      summary: `Set ${input.email} to ${input.mailRole}`,
    })
    return { success: true, data: mapMember(result.rows[0]) }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to upsert member' }
  }
}

export async function removeWorkspaceMember(
  orgId: string,
  userId: string
): Promise<MailApiResult<boolean>> {
  const result = await pool.query(
    `DELETE FROM public.mail_workspace_members WHERE organization_id = $1 AND user_id = $2`,
    [orgId, userId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

/** Resolve effective mail permissions: workspace override → org role. */
export async function resolveEffectiveMailPermissions(
  orgId: string,
  userId: string,
  orgRole: string
): Promise<MailUserPermissions & { mailRole: string; canLaunchCampaigns: boolean }> {
  const override = await pool
    .query<{ mail_role: string; can_launch_campaigns: boolean }>(
      `SELECT mail_role, can_launch_campaigns FROM public.mail_workspace_members
       WHERE organization_id = $1 AND user_id = $2`,
      [orgId, userId]
    )
    .catch(() => ({ rows: [] as { mail_role: string; can_launch_campaigns: boolean }[] }))

  if (override.rows[0]) {
    const role = override.rows[0].mail_role
    const perms = resolveMailPermissions(role)
    return {
      ...perms,
      mailRole: role,
      canLaunchCampaigns: override.rows[0].can_launch_campaigns && perms.canWrite,
    }
  }

  const perms = resolveMailPermissions(orgRole)
  return {
    ...perms,
    mailRole: orgRole || 'viewer',
    canLaunchCampaigns: perms.canWrite,
  }
}

export async function getWorkspaceLifecycle(orgId: string): Promise<WorkspaceLifecycle> {
  const result = await pool
    .query(`SELECT * FROM public.mail_workspace_lifecycle WHERE organization_id = $1`, [orgId])
    .catch(() => ({ rows: [] as Record<string, unknown>[] }))
  if (result.rows[0]) return mapLifecycle(result.rows[0])
  return {
    organizationId: orgId,
    status: 'active',
    graceEndsAt: null,
    scheduledPurgeAt: null,
    reason: null,
    updatedAt: new Date().toISOString(),
  }
}

export async function startWorkspaceGracePeriod(
  orgId: string,
  days = 30,
  reason = 'downgrade'
): Promise<WorkspaceLifecycle> {
  const graceEnds = new Date()
  graceEnds.setUTCDate(graceEnds.getUTCDate() + days)
  const purgeAt = new Date(graceEnds)
  purgeAt.setUTCDate(purgeAt.getUTCDate() + 7)

  const result = await pool.query(
    `INSERT INTO public.mail_workspace_lifecycle
      (organization_id, status, grace_ends_at, scheduled_purge_at, reason, updated_at)
     VALUES ($1, 'grace', $2, $3, $4, NOW())
     ON CONFLICT (organization_id) DO UPDATE SET
       status = 'grace',
       grace_ends_at = EXCLUDED.grace_ends_at,
       scheduled_purge_at = EXCLUDED.scheduled_purge_at,
       reason = EXCLUDED.reason,
       updated_at = NOW()
     RETURNING *`,
    [orgId, graceEnds.toISOString(), purgeAt.toISOString(), reason]
  )
  await recordAuditEvent({
    organizationId: orgId,
    entityType: 'workspace',
    entityId: orgId,
    action: 'grace_started',
    summary: `Grace period until ${graceEnds.toISOString().slice(0, 10)} (${reason})`,
  })
  return mapLifecycle(result.rows[0])
}

export async function restoreWorkspaceActive(orgId: string): Promise<WorkspaceLifecycle> {
  const result = await pool.query(
    `INSERT INTO public.mail_workspace_lifecycle
      (organization_id, status, grace_ends_at, scheduled_purge_at, reason, updated_at)
     VALUES ($1, 'active', NULL, NULL, NULL, NOW())
     ON CONFLICT (organization_id) DO UPDATE SET
       status = 'active',
       grace_ends_at = NULL,
       scheduled_purge_at = NULL,
       reason = NULL,
       updated_at = NOW()
     RETURNING *`,
    [orgId]
  )
  await recordAuditEvent({
    organizationId: orgId,
    entityType: 'workspace',
    entityId: orgId,
    action: 'workspace_restored',
    summary: 'Workspace restored to active',
  })
  return mapLifecycle(result.rows[0])
}

export async function assertWorkspaceSendable(orgId: string): Promise<MailApiResult<true>> {
  const life = await getWorkspaceLifecycle(orgId)
  if (life.status === 'suspended' || life.status === 'pending_delete') {
    return {
      success: false,
      error: `Workspace is ${life.status}. Restore or complete billing to continue sending.`,
    }
  }
  if (life.status === 'grace' && life.graceEndsAt && new Date(life.graceEndsAt) < new Date()) {
    return {
      success: false,
      error: 'Workspace grace period expired. Upgrade or restore to continue.',
    }
  }
  return { success: true, data: true }
}

export async function recordAuditEvent(input: {
  organizationId: string
  actorUserId?: string | null
  actorEmail?: string | null
  entityType: string
  entityId?: string | null
  action: string
  summary?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await pool
    .query(
      `INSERT INTO public.mail_audit_events
        (organization_id, actor_user_id, actor_email, entity_type, entity_id, action, summary, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        input.organizationId,
        input.actorUserId ?? null,
        input.actorEmail ?? null,
        input.entityType,
        input.entityId ?? null,
        input.action,
        input.summary ?? input.action,
        JSON.stringify(input.metadata ?? {}),
      ]
    )
    .catch(() => {})
}

export async function listAuditEvents(
  orgId: string,
  opts?: { limit?: number; entityType?: string; search?: string }
): Promise<AuditEvent[]> {
  const limit = Math.min(opts?.limit ?? 100, 500)
  const result = await pool
    .query(
      `SELECT * FROM public.mail_audit_events
       WHERE organization_id = $1
         AND ($2::text IS NULL OR entity_type = $2)
         AND (
           $3::text IS NULL
           OR action ILIKE '%' || $3 || '%'
           OR summary ILIKE '%' || $3 || '%'
           OR COALESCE(actor_email, '') ILIKE '%' || $3 || '%'
         )
       ORDER BY created_at DESC
       LIMIT $4`,
      [orgId, opts?.entityType ?? null, opts?.search?.trim() || null, limit]
    )
    .catch(() => ({ rows: [] as Record<string, unknown>[] }))
  return result.rows.map(mapAudit)
}

export async function listOrgMembersForInvite(orgId: string): Promise<
  Array<{ userId: string; email: string; role: string }>
> {
  const result = await pool
    .query<{ user_id: string; email: string; role: string }>(
      `SELECT om.user_id, COALESCE(u.email, om.user_id::text) AS email, om.role::text
       FROM public.organization_members om
       LEFT JOIN auth.users u ON u.id = om.user_id
       WHERE om.organization_id = $1
       ORDER BY email ASC
       LIMIT 200`,
      [orgId]
    )
    .catch(() => ({ rows: [] as { user_id: string; email: string; role: string }[] }))
  return result.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    role: r.role,
  }))
}

/** Billing usage snapshot for UI (PRD §6.8.09 / §6.8.23). */
export async function getBillingUsageSnapshot(orgId: string): Promise<{
  plan: { maxMailboxes: number; maxSendsPerDay: number; maxLeads: number }
  usage: { mailboxes: number; sendsToday: number; leads: number; monthSends: number }
  percent: { mailboxes: number; sends: number; leads: number }
  lifecycle: WorkspaceLifecycle
}> {
  const { getOrgPlanLimits } = await import('@/services/mail/plan-limits-service')
  const { getOrgUsageSummary } = await import('@/services/mail/analytics-service')
  const [plan, lifecycle, mb, leads, usageMonth] = await Promise.all([
    getOrgPlanLimits(orgId),
    getWorkspaceLifecycle(orgId),
    pool
      .query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM public.mail_mailboxes WHERE organization_id = $1 AND deleted_at IS NULL`,
        [orgId]
      )
      .catch(() => ({ rows: [{ c: 0 }] })),
    pool
      .query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM public.mail_leads WHERE organization_id = $1`,
        [orgId]
      )
      .catch(() => ({ rows: [{ c: 0 }] })),
    getOrgUsageSummary(orgId).catch(() => ({
      sends: 0,
      opens: 0,
      clicks: 0,
      replies: 0,
      bounces: 0,
      unsubscribes: 0,
      warmupSends: 0,
    })),
  ])

  const sendsToday = await pool
    .query<{ c: number }>(
      `SELECT COALESCE(SUM(sends),0)::int AS c FROM public.mail_mailbox_usage_daily
       WHERE organization_id = $1 AND usage_date = CURRENT_DATE`,
      [orgId]
    )
    .catch(() => ({ rows: [{ c: 0 }] }))

  const mailboxes = mb.rows[0]?.c ?? 0
  const leadCount = leads.rows[0]?.c ?? 0
  const sends = sendsToday.rows[0]?.c ?? 0
  const pct = (n: number, d: number) => (d > 0 ? Math.min(100, Math.round((n / d) * 100)) : 0)

  return {
    plan,
    usage: { mailboxes, sendsToday: sends, leads: leadCount, monthSends: usageMonth.sends },
    percent: {
      mailboxes: pct(mailboxes, plan.maxMailboxes),
      sends: pct(sends, plan.maxSendsPerDay),
      leads: pct(leadCount, plan.maxLeads),
    },
    lifecycle,
  }
}
