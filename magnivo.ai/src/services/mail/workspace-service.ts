import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'

export type SubAccount = {
  id: string
  organizationId: string
  name: string
  status: 'active' | 'inactive' | 'archived'
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function mapRow(row: Record<string, unknown>): SubAccount {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    name: String(row.name),
    status: row.status as SubAccount['status'],
    metadata: (row.metadata as Record<string, unknown>) || {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

export async function listSubAccounts(orgId: string): Promise<SubAccount[]> {
  const result = await pool.query(
    `SELECT * FROM public.mail_sub_accounts
     WHERE organization_id = $1 AND status != 'archived'
     ORDER BY name ASC`,
    [orgId]
  )
  return result.rows.map(mapRow)
}

export async function createSubAccount(
  orgId: string,
  name: string
): Promise<MailApiResult<SubAccount>> {
  if (!name.trim()) return { success: false, error: 'Name is required' }
  try {
    const result = await pool.query(
      `INSERT INTO public.mail_sub_accounts (organization_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [orgId, name.trim()]
    )
    return { success: true, data: mapRow(result.rows[0]) }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create sub-account'
    if (/unique/i.test(message)) return { success: false, error: 'Sub-account name already exists' }
    return { success: false, error: message }
  }
}

export async function updateSubAccount(
  id: string,
  orgId: string,
  input: { name?: string; status?: SubAccount['status'] }
): Promise<MailApiResult<SubAccount>> {
  const result = await pool.query(
    `UPDATE public.mail_sub_accounts SET
       name = COALESCE($3, name),
       status = COALESCE($4, status),
       updated_at = NOW()
     WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [id, orgId, input.name ?? null, input.status ?? null]
  )
  if (!result.rows[0]) return { success: false, error: 'Sub-account not found' }
  return { success: true, data: mapRow(result.rows[0]) }
}

export async function assignMailboxToSubAccount(
  mailboxId: string,
  orgId: string,
  subAccountId: string | null
): Promise<MailApiResult<boolean>> {
  if (subAccountId) {
    const check = await pool.query(
      `SELECT id FROM public.mail_sub_accounts WHERE id = $1 AND organization_id = $2`,
      [subAccountId, orgId]
    )
    if (!check.rows[0]) return { success: false, error: 'Sub-account not found' }
  }
  const result = await pool.query(
    `UPDATE public.mail_mailboxes
     SET sub_account_id = $3, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [mailboxId, orgId, subAccountId]
  )
  return { success: true, data: (result.rowCount ?? 0) > 0 }
}

/** Billing hook interface — records usage events for future metering */
export async function emitBillingUsageHook(input: {
  organizationId: string
  metric: 'mailbox_connected' | 'email_sent' | 'warmup_slot' | 'lead_imported'
  quantity?: number
  mailboxId?: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  await pool.query(
    `INSERT INTO public.mail_notifications
      (organization_id, mailbox_id, type, title, message, severity, metadata)
     VALUES ($1, $2, 'billing_usage', $3, $4, 'info', $5::jsonb)`,
    [
      input.organizationId,
      input.mailboxId ?? null,
      `Usage: ${input.metric}`,
      `Recorded ${input.quantity ?? 1} × ${input.metric}`,
      JSON.stringify({
        metric: input.metric,
        quantity: input.quantity ?? 1,
        ...(input.metadata ?? {}),
        at: new Date().toISOString(),
      }),
    ]
  ).catch(() => {
    // billing hooks must never break send path
  })
}
