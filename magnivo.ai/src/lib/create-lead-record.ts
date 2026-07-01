/**
 * Shared lead-creation logic for dashboard and public API.
 * No 'use server' so Route Handlers can import it (Next.js doesn't expose 'use server' exports to routes).
 */
import pool from '@/lib/db'
import {
  findDuplicateLead,
  getAssignedOwner,
  calculateLeadScore,
  logLeadEvent,
} from '@/app/actions/lead-management'

export type PublicLeadPayload = {
  company: string
  name?: string
  email?: string
  phone?: string
  location?: string
  temperature?: string
  source?: string
  industry?: string
  zip_code?: string
  subject?: string
  campaign?: string
  grade_level?: string
  demo_date?: string
  demo_time_slot?: string
  utm?: Record<string, string>
  value?: string | number | null
}

export type CreateLeadOptions = {
  initialOwnerId?: string | null
  method?: 'manual' | 'public_api' | 'import'
  defaultSource?: string
  performedBy?: string | null
}

export async function createLeadRecord(
  orgId: string,
  payload: PublicLeadPayload,
  options: CreateLeadOptions = {}
): Promise<{ data: any } | { error: string }> {
  const {
    initialOwnerId = null,
    method = 'manual',
    defaultSource = 'Direct',
    performedBy,
  } = options

  try {
    let ownerId: string | null = initialOwnerId
    if (ownerId) {
      const ownerResult = await pool.query(
        'SELECT id FROM public.users WHERE clerk_id = $1 LIMIT 1',
        [ownerId]
      )
      ownerId = ownerResult.rows[0]?.id || null
    }

    const statusResult = await pool.query(
      'SELECT label FROM public.lead_statuses WHERE organization_id = $1 ORDER BY sort_order ASC LIMIT 1',
      [orgId]
    )
    const defaultStatus = statusResult.rows[0]?.label || 'New'
    const temperature = payload.temperature || 'cold'
    const value = payload.value ?? null

    const leadScore = await calculateLeadScore({
      temperature,
      value,
      phone_number: payload.phone,
      contact_person: payload.name || payload.company,
      industry: payload.industry,
      zip_code: payload.zip_code,
    })

    const data: any = {
      organization_id: orgId,
      name: payload.company,
      contact_person: payload.name || '',
      phone_number: payload.phone || '',
      location: payload.location || '',
      temperature,
      source: payload.source || defaultSource,
      industry: payload.industry || '',
      zip_code: payload.zip_code || '',
      status: defaultStatus,
      owner_id: ownerId,
      lead_score: leadScore,
      email: payload.email || undefined,
      subject: payload.subject || null,
      campaign: payload.campaign || null,
      grade_level: payload.grade_level || null,
      demo_date: payload.demo_date || null,
      demo_time_slot: payload.demo_time_slot || null,
      ...(payload.utm &&
        Object.keys(payload.utm).length > 0 && { utm_metadata: payload.utm }),
    }

    const dupCheck = await findDuplicateLead(null, orgId, data)
    if (dupCheck) {
      if (dupCheck.strategy === 'auto') {
        return { error: `Duplicate lead found (Auto-blocked): ${data.name}` }
      }
      return {
        error: `Duplicate detected. Manual merge required for ${data.name}`,
      }
    }

    const assignedOwnerId = await getAssignedOwner(null, orgId, data)
    if (assignedOwnerId) {
      data.owner_id = assignedOwnerId
    }

    const keys = Object.keys(data).filter(k => data[k] !== undefined)
    const vals = keys.map(k => data[k])
    const columns = keys.map(k => `"${k}"`).join(', ')
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')

    const insertResult = await pool.query(
      `INSERT INTO public.leads (${columns}) VALUES (${placeholders}) RETURNING *`,
      vals
    )
    const insertedData = insertResult.rows[0]

    if (!insertedData) {
      return { error: 'Failed to insert lead' }
    }

    await logLeadEvent(null, orgId, {
      lead_id: insertedData.id,
      event_type: 'lead_created',
      description:
        method === 'public_api'
          ? 'Lead created via public API.'
          : 'Lead created manually.',
      metadata: { source: data.source, method },
      performed_by: performedBy || undefined,
    })

    return { data: insertedData }
  } catch (err: any) {
    console.error('Error adding lead:', err)
    return { error: err.message }
  }
}
