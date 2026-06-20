import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// 1x1 transparent GIF served to record an email open.
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const email = (params.get('e') || '').toLowerCase().trim()
  const campaignId = params.get('c')
  const leadId = params.get('l')

  try {
    if (email || campaignId) {
      const supabase = createServiceClient()
      const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
      const base = {
        organization_id: org?.id ?? null,
        email,
        campaign_id: campaignId,
        opened_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('outreach_opens')
        .insert({ ...base, lead_id: leadId ? Number(leadId) : null })
      // lead_id is FK-constrained — if the lead was deleted since the send,
      // still record the open (analytics aggregate by email) without it.
      if (error && leadId) {
        await supabase.from('outreach_opens').insert({ ...base, lead_id: null })
      }
    }
  } catch (e) {
    console.error('[track/open] failed:', e instanceof Error ? e.message : e)
  }

  return new NextResponse(PIXEL, {
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    },
  })
}
