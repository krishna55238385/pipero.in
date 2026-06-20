import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// One-click unsubscribe target. Records the opt-out (suppression list is
// enforced by every send path) and shows a minimal confirmation page.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const email = (params.get('e') || '').toLowerCase().trim()
  const campaignId = params.get('c')
  const leadId = params.get('l')

  let ok = false
  try {
    if (email) {
      const supabase = createServiceClient()
      const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
      const { error } = await supabase.from('outreach_unsubscribes').upsert(
        {
          email,
          organization_id: org?.id ?? null,
          lead_id: leadId ? Number(leadId) : null,
          campaign_id: campaignId,
          unsubscribed_at: new Date().toISOString(),
        },
        { onConflict: 'email' },
      )
      ok = !error
      if (error) console.error('[track/unsubscribe] failed:', error.message)
    }
  } catch (e) {
    console.error('[track/unsubscribe] failed:', e instanceof Error ? e.message : e)
  }

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc">
  <div style="text-align:center;padding:32px;border-radius:16px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08)">
    <h1 style="font-size:20px;margin:0 0 8px">${ok ? "You're unsubscribed" : 'Something went wrong'}</h1>
    <p style="color:#64748b;margin:0">${ok ? 'You will not receive further emails from us.' : 'Please try the link again later.'}</p>
  </div>
</body></html>`
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
