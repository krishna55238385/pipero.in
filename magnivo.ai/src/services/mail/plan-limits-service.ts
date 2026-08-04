import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'

export type PlanLimits = {
  maxMailboxes: number
  maxSendsPerDay: number
  maxLeads: number
}

const DEFAULTS: PlanLimits = {
  maxMailboxes: 50,
  maxSendsPerDay: 10_000,
  maxLeads: 100_000,
}

export async function getOrgPlanLimits(orgId: string): Promise<PlanLimits> {
  const r = await pool.query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM public.mail_org_settings WHERE organization_id = $1`,
    [orgId]
  ).catch(() => ({ rows: [] as { metadata: Record<string, unknown> }[] }))
  const meta = r.rows[0]?.metadata || {}
  return {
    maxMailboxes: Number(meta.maxMailboxes ?? meta.max_mailboxes ?? DEFAULTS.maxMailboxes),
    maxSendsPerDay: Number(meta.maxSendsPerDay ?? meta.max_sends_per_day ?? DEFAULTS.maxSendsPerDay),
    maxLeads: Number(meta.maxLeads ?? meta.max_leads ?? DEFAULTS.maxLeads),
  }
}

export async function assertCanAddMailbox(orgId: string): Promise<MailApiResult<true>> {
  const limits = await getOrgPlanLimits(orgId)
  const count = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.mail_mailboxes
     WHERE organization_id = $1 AND deleted_at IS NULL`,
    [orgId]
  )
  if ((count.rows[0]?.c ?? 0) >= limits.maxMailboxes) {
    return {
      success: false,
      error: `Plan limit reached: max ${limits.maxMailboxes} mailboxes. Upgrade to add more.`,
    }
  }
  return { success: true, data: true }
}

export async function assertCanEnrollLeads(
  orgId: string,
  additional = 1
): Promise<MailApiResult<true>> {
  const { assertWorkspaceSendable } = await import('@/services/mail/workspace-governance-service')
  const life = await assertWorkspaceSendable(orgId)
  if (!life.success) return life

  const limits = await getOrgPlanLimits(orgId)
  const sends = await pool.query<{ c: number }>(
    `SELECT COALESCE(SUM(sends),0)::int AS c FROM public.mail_mailbox_usage_daily
     WHERE organization_id = $1 AND usage_date = CURRENT_DATE`,
    [orgId]
  )
  if ((sends.rows[0]?.c ?? 0) >= limits.maxSendsPerDay) {
    return {
      success: false,
      error: `Daily send plan limit reached (${limits.maxSendsPerDay}). Upgrade your plan to continue enrolling — in-flight sends will complete.`,
    }
  }
  const leads = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM public.mail_leads WHERE organization_id = $1`,
    [orgId]
  )
  if ((leads.rows[0]?.c ?? 0) + additional > limits.maxLeads) {
    return {
      success: false,
      error: `Lead plan limit reached (max ${limits.maxLeads}). Upgrade to import more.`,
    }
  }
  return { success: true, data: true }
}

/** @deprecated Use assertCanAddMailbox */
export async function checkMailboxLimit(orgId: string): Promise<{ allowed: boolean; reason?: string }> {
  const result = await assertCanAddMailbox(orgId)
  if (!result.success) return { allowed: false, reason: result.error }
  return { allowed: true }
}

/** @deprecated Use assertCanEnrollLeads */
export async function assertEnrollmentAllowed(orgId: string): Promise<{ allowed: boolean; reason?: string }> {
  const result = await assertCanEnrollLeads(orgId)
  if (!result.success) return { allowed: false, reason: result.error }
  return { allowed: true }
}
