import pool from '@/lib/db'
import * as mailboxRepo from '@/repositories/mail/mailbox-repository'
import * as domainRepo from '@/repositories/mail/domain-repository'
import type { MailApiResult, Mailbox } from '@/types/mail'

/**
 * DNS gate for warmup eligibility (PRD §6.2 / §14).
 * Requires SPF + DKIM verified. DMARC may be overridden → at_risk.
 */
export async function evaluateDnsGateForMailbox(
  mailboxId: string,
  orgId: string
): Promise<{
  spfOk: boolean
  dkimOk: boolean
  dmarcOk: boolean
  canWarmup: boolean
  recommendedStatus: 'pending_dns' | 'pending_warmup' | 'at_risk'
  message: string
}> {
  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) {
    return {
      spfOk: false,
      dkimOk: false,
      dmarcOk: false,
      canWarmup: false,
      recommendedStatus: 'pending_dns',
      message: 'Mailbox not found',
    }
  }

  const domainName = mailbox.email.split('@')[1]?.toLowerCase()
  if (!domainName) {
    return {
      spfOk: false,
      dkimOk: false,
      dmarcOk: false,
      canWarmup: false,
      recommendedStatus: 'pending_dns',
      message: 'Invalid mailbox email domain',
    }
  }

  const domain = await domainRepo.findDomainByName(domainName, orgId)
  const spfOk = domain?.spfStatus === 'valid'
  const dkimOk = domain?.dkimStatus === 'valid'
  const dmarcOk = domain?.dmarcStatus === 'valid'
  const override = Boolean(
    (mailbox as Mailbox & { dnsRiskOverride?: boolean }).dnsRiskOverride ||
      (mailbox.metadata as { dnsRiskOverride?: boolean } | undefined)?.dnsRiskOverride
  )

  if (spfOk && dkimOk && dmarcOk) {
    return {
      spfOk,
      dkimOk,
      dmarcOk,
      canWarmup: true,
      recommendedStatus: 'pending_warmup',
      message: 'SPF, DKIM, and DMARC verified',
    }
  }

  if (spfOk && dkimOk && (!dmarcOk) && override) {
    return {
      spfOk,
      dkimOk,
      dmarcOk,
      canWarmup: true,
      recommendedStatus: 'at_risk',
      message: 'SPF+DKIM verified; DMARC overridden — mailbox at risk',
    }
  }

  if (spfOk && dkimOk && !dmarcOk) {
    return {
      spfOk,
      dkimOk,
      dmarcOk,
      canWarmup: false,
      recommendedStatus: 'pending_dns',
      message: 'DMARC missing — verify DMARC or use “I’ll do this later” override',
    }
  }

  return {
    spfOk,
    dkimOk,
    dmarcOk,
    canWarmup: false,
    recommendedStatus: 'pending_dns',
    message: 'SPF and DKIM must both pass before warmup',
  }
}

export async function applyDnsGateStatus(
  mailboxId: string,
  orgId: string
): Promise<MailApiResult<{ status: string; message: string }>> {
  const gate = await evaluateDnsGateForMailbox(mailboxId, orgId)
  if (gate.canWarmup) {
    await mailboxRepo.transitionMailboxStatus(mailboxId, orgId, gate.recommendedStatus)
    return { success: true, data: { status: gate.recommendedStatus, message: gate.message } }
  }
  await mailboxRepo.transitionMailboxStatus(mailboxId, orgId, 'pending_dns')
  return { success: true, data: { status: 'pending_dns', message: gate.message } }
}

export async function overrideDmarcRisk(
  mailboxId: string,
  orgId: string,
  actor: { userId: string; email: string }
): Promise<MailApiResult<Mailbox>> {
  const gate = await evaluateDnsGateForMailbox(mailboxId, orgId)
  if (!gate.spfOk || !gate.dkimOk) {
    return { success: false, error: 'SPF and DKIM must pass before using the DMARC override' }
  }

  await pool.query(
    `UPDATE public.mail_mailboxes
     SET dns_risk_override = TRUE,
         dns_risk_override_at = NOW(),
         dns_risk_override_by = $3,
         mailbox_status = 'at_risk',
         metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb,
         updated_at = NOW()
     WHERE id = $1 AND organization_id = $2`,
    [
      mailboxId,
      orgId,
      actor.userId,
      JSON.stringify({ dnsRiskOverride: true, overriddenBy: actor.email }),
    ]
  )

  const mailbox = await mailboxRepo.findMailboxById(mailboxId, orgId)
  if (!mailbox) return { success: false, error: 'Mailbox not found' }
  return { success: true, data: mailbox }
}
