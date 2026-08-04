import { NextRequest, NextResponse } from 'next/server'
import { consumeUnsubscribeToken, suppressEmail } from '@/services/mail/suppression-service'

async function handleUnsubscribe(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams
  const token = params.get('token') || ''
  const emailParam = (params.get('e') || '').toLowerCase().trim()
  const campaignId = params.get('c')
  const leadId = params.get('l')
  const orgIdParam = params.get('o')

  let ok = false
  try {
    if (token) {
      const result = await consumeUnsubscribeToken(token)
      ok = result.success
    } else if (emailParam && orgIdParam) {
      // Legacy links that include explicit org id
      await suppressEmail(orgIdParam, emailParam, 'unsubscribe', 'one_click', leadId, campaignId)
      ok = true
    } else if (emailParam) {
      // Legacy insecure links — still suppress globally by email in outreach_unsubscribes
      // but require org when possible; without org we only write email-level unsub
      const { default: pool } = await import('@/lib/db')
      await pool.query(
        `INSERT INTO public.outreach_unsubscribes (email, campaign_id, lead_id, unsubscribed_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NOW()`,
        [emailParam, campaignId, leadId ? Number(leadId) : null]
      )
      ok = true
    }
  } catch (e) {
    console.error('[track/unsubscribe] failed:', e instanceof Error ? e.message : e)
  }

  if (req.method === 'POST') {
    // RFC 8058 one-click POST expects 200 empty or minimal body
    return new NextResponse(ok ? 'OK' : 'ERROR', {
      status: ok ? 200 : 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
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

export async function GET(req: NextRequest) {
  return handleUnsubscribe(req)
}

export async function POST(req: NextRequest) {
  return handleUnsubscribe(req)
}
