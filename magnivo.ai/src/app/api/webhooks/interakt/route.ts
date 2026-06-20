import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json()
    
    // DEBUG: Log payload to an absolute path we can definitely read
    try {
        const fs = require('fs')
        const path = require('path')
        const logPath = path.join(process.cwd(), 'webhook_logs.json')
        fs.appendFileSync(logPath, JSON.stringify({ timestamp: new Date().toISOString(), payload }, null, 2) + ',\n')
    } catch (e) {
        console.error('Failed to log webhook:', e)
    }

    const { type, data } = payload

    // Handle both received (customer) and sent (agent from Interakt dashboard)
    if (type !== 'message_received' && type !== 'message_sent') {
      return NextResponse.json({ success: true, message: 'Skipped irrelevant event' })
    }

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => [], setAll: () => {} } }
    )

    const customer = data.customer
    const interaktMsg = data.message
    
    // Normalize phone number: strip + and common country codes to match our 10-digit storage
    let rawPhone = customer.phone_number.replace(/\+/g, '')
    if (rawPhone.startsWith('91') && rawPhone.length === 12) {
        rawPhone = rawPhone.substring(2)
    } else if (rawPhone.startsWith('1') && rawPhone.length === 11) {
        rawPhone = rawPhone.substring(1)
    } else if (rawPhone.length > 10) {
        rawPhone = rawPhone.slice(-10)
    }
    
    // Determine sender type
    const sender_type = type === 'message_received' ? 'user' : 'agent'

    // 1. Find lead using multiple possible formats to be robust
    let { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('id, organization_id')
      .or(`phone_number.eq.${rawPhone},phone_number.eq.+91${rawPhone},phone_number.eq.91${rawPhone}`)
      .limit(1)
      .maybeSingle()

    if (leadError) {
        console.error('Lead lookup error:', leadError)
    }

    if (!lead) {
       // Search for any organization to assign the new lead to
       const { data: org, error: orgError } = await supabase.from('organizations').select('id').limit(1).single()
       if (orgError || !org) {
           return NextResponse.json({ error: 'No organization found' }, { status: 400 })
       }

       const { data: newLead, error: createError } = await supabase
         .from('leads')
         .insert({
           organization_id: org.id,
           name: customer.full_name || 'WhatsApp Lead',
           contact_person: customer.full_name,
           phone_number: rawPhone,
           source: 'WhatsApp'
         })
         .select()
         .single()
       
       if (createError || !newLead) {
           console.error('Failed to create lead:', createError)
           throw createError || new Error('Failed to create lead')
       }
       lead = newLead
    }

    if (!lead || !lead.id) throw new Error('Lead missing after creation/lookup')

    // 2. Find or create conversation
    let { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, unread_count')
      .eq('lead_id', lead.id)
      .maybeSingle()

    if (!conversation) {
      const { data: newConv, error: createConvError } = await supabase
        .from('conversations')
        .insert({
          organization_id: lead.organization_id,
          lead_id: lead.id,
          unread_count: type === 'message_received' ? 1 : 0,
          last_customer_message_at: new Date().toISOString()
        })
        .select()
        .single()
      
      if (createConvError) {
          console.error('Failed to create conversation:', createConvError)
          throw createConvError
      }
      conversation = newConv
    } else {
      await supabase
        .from('conversations')
        .update({
          unread_count: type === 'message_received' ? (conversation.unread_count || 0) + 1 : conversation.unread_count,
          last_customer_message_at: new Date().toISOString()
        })
        .eq('id', conversation.id)
    }

    // 3. Normalize Message Type and Media
    let messageType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text'
    let mediaUrl = interaktMsg.media_url || null
    
    const interaktType = (interaktMsg.message_type || 'Text').toLowerCase()
    if (interaktType === 'image') messageType = 'image'
    else if (interaktType === 'video') messageType = 'video'
    else if (interaktType === 'audio' || interaktType === 'voice') messageType = 'audio'
    else if (interaktType === 'document' || interaktType === 'file') messageType = 'document'

    if (!conversation || !conversation.id) {
        console.error('Conversation missing before message insertion')
        throw new Error('Conversation missing')
    }

    // 4. Insert message
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversation.id,
        organization_id: lead.organization_id,
        sender_type: sender_type,
        message_type: messageType,
        content: interaktMsg.message_text || null,
        media_url: mediaUrl,
        interakt_message_id: interaktMsg.id,
        status: 'read', // Incoming is always read by the customer perspective
        created_at: new Date(interaktMsg.created_at_utc || new Date()).toISOString()
      })

    if (msgError) {
        console.error('Failed to insert message:', msgError)
        throw msgError
    }

    // 5. Log Activity
    await supabase.from('activity_logs').insert({
      organization_id: lead.organization_id,
      action: 'whatsapp',
      details: `Received WhatsApp (${messageType}): ${interaktMsg.message_text || '(No text)'}`,
      lead_id: lead.id
    })

    revalidatePath('/inbox')
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Interakt Webhook Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
