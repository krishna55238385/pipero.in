import pool from '@/lib/db'
import type { MailboxAuditAction, MailboxAuditLogEntry, MailboxStatus } from '@/types/mail'

type AuditLogRow = {
  id: string
  organization_id: string
  mailbox_id: string
  actor_user_id: string
  actor_email: string
  action: MailboxAuditAction
  previous_status: MailboxStatus | null
  new_status: MailboxStatus | null
  metadata: Record<string, unknown>
  created_at: string
}

function mapAuditRow(row: AuditLogRow): MailboxAuditLogEntry {
  return {
    id: row.id,
    organizationId: row.organization_id,
    mailboxId: row.mailbox_id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    action: row.action,
    previousStatus: row.previous_status,
    newStatus: row.new_status,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  }
}

export type InsertAuditEventInput = {
  organizationId: string
  mailboxId: string
  actorUserId: string
  actorEmail: string
  action: MailboxAuditAction
  previousStatus: MailboxStatus | null
  newStatus: MailboxStatus | null
  metadata?: Record<string, unknown>
}

export async function insertAuditEvent(input: InsertAuditEventInput): Promise<MailboxAuditLogEntry> {
  const result = await pool.query<AuditLogRow>(
    `INSERT INTO public.mailbox_audit_log
      (organization_id, mailbox_id, actor_user_id, actor_email, action, previous_status, new_status, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.organizationId,
      input.mailboxId,
      input.actorUserId,
      input.actorEmail,
      input.action,
      input.previousStatus,
      input.newStatus,
      JSON.stringify(input.metadata ?? {}),
    ]
  )
  return mapAuditRow(result.rows[0])
}

export async function findAuditEventsByMailbox(
  mailboxId: string,
  orgId: string,
  limit: number = 50,
  offset: number = 0
): Promise<MailboxAuditLogEntry[]> {
  const result = await pool.query<AuditLogRow>(
    `SELECT * FROM public.mailbox_audit_log
     WHERE mailbox_id = $1 AND organization_id = $2
     ORDER BY created_at DESC
     LIMIT $3 OFFSET $4`,
    [mailboxId, orgId, limit, offset]
  )
  return result.rows.map(mapAuditRow)
}

export async function findAuditEventsByOrg(
  orgId: string,
  limit: number = 100,
  offset: number = 0
): Promise<MailboxAuditLogEntry[]> {
  const result = await pool.query<AuditLogRow>(
    `SELECT * FROM public.mailbox_audit_log
     WHERE organization_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [orgId, limit, offset]
  )
  return result.rows.map(mapAuditRow)
}

export async function countAuditEventsByMailbox(
  mailboxId: string,
  orgId: string
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.mailbox_audit_log
     WHERE mailbox_id = $1 AND organization_id = $2`,
    [mailboxId, orgId]
  )
  return result.rows[0]?.count ?? 0
}
