import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  createLeadRecord,
  PublicLeadPayload,
} from '@/lib/create-lead-record'
import { sendWhatsAppTemplateForLead } from '@/app/actions/interakt'

// Allow longer run for Supabase + routing (e.g. when running locally or cold start)
export const maxDuration = 30

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return NextResponse.json({}, { status: 200, headers: corsHeaders })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Accept common Zapier/Facebook/landing-page field names
    const rawName =
      body.name ??
      body.full_name ??
      body.student_name ??
      body.contact_person ??
      (body.first_name || body.last_name
        ? [body.first_name, body.last_name].filter(Boolean).join(' ')
        : '')
    const name = String(rawName || '').trim()

    const rawPhone =
      body.phone ?? body.phone_number ?? body.mobile ?? body.telephone ?? ''
    const phone = String(rawPhone || '').replace(/\s/g, '').trim()

    const rawEmail = body.email ?? body.email_address ?? body.mail ?? ''
    const email = rawEmail ? String(rawEmail).trim() : undefined

    const companyRaw =
      body.company ??
      body.company_name ??
      body.organization ??
      (name || 'Landing Page')
    const company = String(companyRaw || '').trim() || (name || 'Landing Page')

    const payload: PublicLeadPayload = {
      company,
      name,
      email: email || undefined,
      phone,
      location: body.location ? String(body.location).trim() : '',
      temperature: body.temperature ? String(body.temperature).trim() : undefined,
      source: body.source ? String(body.source).trim() : undefined,
      industry: body.industry ? String(body.industry).trim() : undefined,
      zip_code: body.zip_code ? String(body.zip_code).trim() : undefined,
      subject: body.subject ? String(body.subject).trim() : undefined,
      campaign: body.campaign ? String(body.campaign).trim() : undefined,
      grade_level: body.grade_level ? String(body.grade_level).trim() : undefined,
      demo_date: body.demo_date ? String(body.demo_date).trim() : undefined,
      demo_time_slot: body.demo_time_slot ? String(body.demo_time_slot).trim() : undefined,
      utm: body.utm && typeof body.utm === 'object' ? body.utm : undefined,
      value: body.value ?? null
    }

    if (!payload.company) {
      return NextResponse.json(
        { success: false, error: 'company is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    if (!payload.email && !payload.phone) {
      return NextResponse.json(
        { success: false, error: 'At least email or phone is required' },
        { status: 400, headers: corsHeaders }
      )
    }

    const supabase = await createClient()
    if (!supabase) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error. Please try again later.' },
        { status: 503, headers: corsHeaders }
      )
    }
    const { data: org } = await supabase.from('organizations').select('id').limit(1).single()

    if (!org?.id) {
      return NextResponse.json(
        { success: false, error: 'No organization found' },
        { status: 500, headers: corsHeaders }
      )
    }

    const result = await createLeadRecord(supabase, org.id, payload, {
      method: 'public_api',
      defaultSource: payload.source || 'Landing Page',
      initialOwnerId: null,
      performedBy: null
    })

    if ('error' in result) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400, headers: corsHeaders }
      )
    }

    // Fire-and-forget: send WhatsApp welcome template for Facebook leads
    const sourceLower = (payload.source || '').toLowerCase()
    if (sourceLower === 'facebook lead ads' && payload.phone) {
      try {
        await sendWhatsAppTemplateForLead(
          (result as any).data.id,
          undefined,
          [
            payload.name || payload.company,
            payload.campaign || '',
          ]
        )
      } catch (e) {
        console.error('Failed to send Facebook welcome WhatsApp template', e)
      }
    }

    return NextResponse.json({
      success: true,
      leadId: result.data.id,
      status: 'created'
    }, { headers: corsHeaders })
  } catch (error: any) {
    console.error('Public leads API error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Unexpected error' },
      { status: 500, headers: corsHeaders }
    )
  }
}

