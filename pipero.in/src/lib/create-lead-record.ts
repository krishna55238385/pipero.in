/**
 * Shared lead-creation logic for dashboard and public API.
 * No 'use server' so Route Handlers can import it (Next.js doesn't expose 'use server' exports to routes).
 */
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
  supabase: any,
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

  const { data: statuses } = await supabase
    .from('lead_statuses')
    .select('label')
    .eq('organization_id', orgId)
    .order('sort_order', { ascending: true })
    .limit(1)

  const defaultStatus = statuses?.[0]?.label || 'New'
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
    owner_id: initialOwnerId,
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

  const dupCheck = await findDuplicateLead(supabase, orgId, data)
  if (dupCheck) {
    if (dupCheck.strategy === 'auto') {
      return { error: `Duplicate lead found (Auto-blocked): ${data.name}` }
    }
    return {
      error: `Duplicate detected. Manual merge required for ${data.name}`,
    }
  }

  const assignedOwnerId = await getAssignedOwner(supabase, orgId, data)
  if (assignedOwnerId) {
    data.owner_id = assignedOwnerId
  }

  const { data: insertedData, error } = await supabase
    .from('leads')
    .insert(data)
    .select()
    .single()

  if (error) {
    console.error('Error adding lead:', error)
    return { error: error.message }
  }

  await logLeadEvent(supabase, orgId, {
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
}
