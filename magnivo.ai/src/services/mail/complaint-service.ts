import * as complaintRepo from '@/repositories/mail/complaint-repository'
import type { ComplaintRecord, ComplaintStatus, ComplaintDashboardStats } from '@/types/deliverability'

export async function listComplaints(orgId: string, limit?: number): Promise<ComplaintRecord[]> {
  return complaintRepo.findComplaintsByOrg(orgId, limit)
}

export async function getActiveComplaints(orgId: string): Promise<ComplaintRecord[]> {
  return complaintRepo.findActiveComplaints(orgId)
}

export async function getComplaint(id: string, orgId: string): Promise<ComplaintRecord | null> {
  return complaintRepo.findComplaintById(id, orgId)
}

export async function recordComplaint(data: {
  organizationId: string
  domainId: string
  mailboxId?: string
  campaignId?: string
  complaintType: string
  source: string
  autoPausedMailbox?: boolean
}): Promise<ComplaintRecord> {
  const complaint = await complaintRepo.insertComplaint(data)

  if (data.autoPausedMailbox && data.mailboxId) {
    try {
      const pool = (await import('@/lib/db')).default
      await pool.query(
        `UPDATE public.mail_mailboxes SET mailbox_status = 'error', updated_at = NOW()
         WHERE id = $1`,
        [data.mailboxId]
      )
    } catch {
      console.error('[complaint-service] Failed to auto-pause mailbox')
    }
  }

  return complaint
}

export async function resolveComplaint(id: string, orgId: string, resolvedBy: string): Promise<{ complaint: ComplaintRecord | null; error?: string }> {
  const existing = await complaintRepo.findComplaintById(id, orgId)
  if (!existing) return { complaint: null, error: 'Complaint not found' }

  const updated = await complaintRepo.updateComplaint(id, orgId, {
    status: 'resolved',
    resolvedAt: new Date().toISOString(),
    resolvedBy,
  })

  return { complaint: updated }
}

export async function dismissComplaint(id: string, orgId: string): Promise<{ complaint: ComplaintRecord | null; error?: string }> {
  const existing = await complaintRepo.findComplaintById(id, orgId)
  if (!existing) return { complaint: null, error: 'Complaint not found' }

  const updated = await complaintRepo.updateComplaint(id, orgId, {
    status: 'dismissed',
  })

  return { complaint: updated }
}

export async function updateComplaintStatus(id: string, orgId: string, status: ComplaintStatus): Promise<{ complaint: ComplaintRecord | null; error?: string }> {
  const existing = await complaintRepo.findComplaintById(id, orgId)
  if (!existing) return { complaint: null, error: 'Complaint not found' }

  const updated = await complaintRepo.updateComplaint(id, orgId, { status })
  return { complaint: updated }
}

export async function getComplaintDashboardStats(orgId: string): Promise<ComplaintDashboardStats> {
  return complaintRepo.getComplaintDashboardStats(orgId)
}
