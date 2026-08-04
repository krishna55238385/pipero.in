import * as bounceRepo from '@/repositories/mail/bounce-repository'
import type { BounceRecord, BounceType, BounceCategory, BounceDashboardStats } from '@/types/deliverability'

export async function listBounces(orgId: string, limit?: number): Promise<BounceRecord[]> {
  return bounceRepo.findBouncesByOrg(orgId, limit)
}

export async function listBouncesByMailbox(mailboxId: string, limit?: number): Promise<BounceRecord[]> {
  return bounceRepo.findBouncesByMailbox(mailboxId, limit)
}

export async function getBounce(id: string, orgId: string): Promise<BounceRecord | null> {
  return bounceRepo.findBounceById(id, orgId)
}

export async function recordBounce(data: {
  organizationId: string
  domainId: string
  mailboxId?: string
  campaignId?: string
  recipientEmail: string
  bounceType: BounceType
  bounceCategory: BounceCategory
  smtpCode?: string
  diagnosticCode?: string
}): Promise<BounceRecord> {
  const bounce = await bounceRepo.insertBounce(data)

  if (data.bounceType === 'hard') {
    await bounceRepo.suppressEmail(data.organizationId, data.recipientEmail, 'hard_bounce')
  }

  if (data.bounceCategory === 'other' || !data.diagnosticCode?.trim()) {
    const pool = (await import('@/lib/db')).default
    await pool.query(
      `INSERT INTO public.mail_notifications
        (organization_id, mailbox_id, type, title, message, severity, metadata)
       VALUES ($1,$2,'bounce_review','Bounce needs review',
               'Unknown bounce pattern — manual review required','warning',$3::jsonb)`,
      [
        data.organizationId,
        data.mailboxId ?? null,
        JSON.stringify({
          recipientEmail: data.recipientEmail,
          bounceType: data.bounceType,
          bounceCategory: data.bounceCategory,
          smtpCode: data.smtpCode ?? null,
          diagnosticCode: data.diagnosticCode ?? null,
          campaignId: data.campaignId ?? null,
        }),
      ]
    ).catch(() => {})
  }

  return bounce
}

export function classifyBounceFromDiagnostic(
  diagnosticCode?: string | null,
  smtpCode?: string | null
): BounceCategory {
  const text = `${diagnosticCode ?? ''} ${smtpCode ?? ''}`.toLowerCase()
  if (!text.trim()) return 'other'
  if (/user unknown|no such user|invalid recipient|mailbox unavailable|550/.test(text)) {
    return 'invalid_email'
  }
  if (/mailbox full|quota|452|552/.test(text)) return 'mailbox_full'
  if (/domain not found|dns|nxdomain/.test(text)) return 'domain_not_found'
  if (/timeout|timed out|421/.test(text)) return 'timeout'
  if (/content rejected|policy|spam|blocked/.test(text)) return 'content_rejected'
  if (/too many recipients/.test(text)) return 'too_many_recipients'
  if (/network|connection/.test(text)) return 'network_error'
  if (/rejected|permanent|5\d\d/.test(text)) return 'rejected'
  return 'other'
}

export async function processRetries(orgId: string): Promise<{ retried: number; suppressed: number }> {
  const retriableBounces = await bounceRepo.findRetriableBounces(orgId)
  let retried = 0
  let suppressed = 0

  for (const bounce of retriableBounces) {
    const newRetryCount = bounce.retryCount + 1

    if (newRetryCount >= 3) {
      await bounceRepo.updateBounce(bounce.id, {
        suppressed: true,
        nextRetryAt: null,
      })
      await bounceRepo.suppressEmail(orgId, bounce.recipientEmail, 'soft_bounce_max_retries')
      suppressed++
    } else {
      const backoffMs = Math.pow(2, newRetryCount) * 60 * 60 * 1000
      await bounceRepo.updateBounce(bounce.id, {
        retryCount: newRetryCount,
        nextRetryAt: new Date(Date.now() + backoffMs).toISOString(),
      })
      retried++
    }
  }

  return { retried, suppressed }
}

export async function isEmailSuppressed(orgId: string, email: string): Promise<boolean> {
  return bounceRepo.isEmailSuppressed(orgId, email)
}

export async function getBounceDashboardStats(orgId: string): Promise<BounceDashboardStats> {
  return bounceRepo.getBounceDashboardStats(orgId)
}

export async function getBounceAnalytics(orgId: string): Promise<{
  hardBounceRate: number
  softBounceRate: number
  topCategories: { category: BounceCategory; count: number }[]
}> {
  const stats = await bounceRepo.getBounceDashboardStats(orgId)
  const total = stats.totalBounces || 1

  const categoryResult = await bounceRepo.findBouncesByOrg(orgId, 1000)
  const categoryCounts: Record<string, number> = {}
  for (const bounce of categoryResult) {
    categoryCounts[bounce.bounceCategory] = (categoryCounts[bounce.bounceCategory] || 0) + 1
  }

  const topCategories = Object.entries(categoryCounts)
    .map(([category, count]) => ({ category: category as BounceCategory, count }))
    .sort((a, b) => b.count - a.count)

  return {
    hardBounceRate: stats.hardBounces / total,
    softBounceRate: stats.softBounces / total,
    topCategories,
  }
}
