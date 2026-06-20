import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// Records a link click then 302-redirects to the original destination.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const email = (params.get('e') || '').toLowerCase().trim()
  const campaignId = params.get('c')
  const leadId = params.get('l')
  const target = params.get('u') || ''

  let destination: URL | null = null
  try {
    destination = new URL(target)
    if (!['http:', 'https:'].includes(destination.protocol)) destination = null
  } catch {
    destination = null
  }

  try {
    if (destination && (email || campaignId)) {
      const supabase = createServiceClient()
      const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
      const base = {
        organization_id: org?.id ?? null,
        email,
        campaign_id: campaignId,
        url: destination.toString().slice(0, 2000),
        clicked_at: new Date().toISOString(),
      }
      const { error } = await supabase
        .from('outreach_clicks')
        .insert({ ...base, lead_id: leadId ? Number(leadId) : null })
      if (error && leadId) {
        await supabase.from('outreach_clicks').insert({ ...base, lead_id: null })
      }
    }
  } catch (e) {
    console.error('[track/click] failed:', e instanceof Error ? e.message : e)
  }

  return NextResponse.redirect(destination ? destination.toString() : new URL('/', req.url), 302)
}
