'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY
const INTERAKT_FB_TEMPLATE_NAME = process.env.INTERAKT_FB_TEMPLATE_NAME
const INTERAKT_FB_TEMPLATE_LANG = process.env.INTERAKT_FB_TEMPLATE_LANG || 'en'

export async function sendWhatsAppMessage(
    leadId: string, 
    content: string, 
    messageType: 'text' | 'image' | 'document' | 'video' | 'audio' = 'text',
    mediaUrl?: string
) {
    try {
        const supabase = await createClient()
        
        // 1. Get lead and organization info
        const { data: lead, error: leadError } = await supabase
            .from('leads')
            .select('phone_number, organization_id')
            .eq('id', leadId)
            .single()

        if (leadError || !lead) throw new Error('Lead not found')

        // 2. Find or create conversation
        let { data: conversation, error: convError } = await supabase
            .from('conversations')
            .select('id')
            .eq('lead_id', leadId)
            .single()

        if (!conversation || !conversation.id) {
            const { data: newConv, error: createConvError } = await supabase
                .from('conversations')
                .insert({
                    organization_id: lead.organization_id,
                    lead_id: leadId,
                    unread_count: 0
                })
                .select()
                .single()
            
            if (createConvError) throw createConvError
            if (!newConv) throw new Error('Failed to create conversation')
            conversation = newConv
        }

        // 3. Call Interakt API
        let interaktMessageId = null
        if (INTERAKT_API_KEY) {
            try {
                // Normalize based on our DB storage (10 digits)
                let raw = lead.phone_number.replace(/\+/g, '')
                let targetPhone = raw
                
                if (raw.length === 10) {
                    const usAreaCodes = ['562', '631', '267', '980', '240', '484', '864']
                    const isUS = usAreaCodes.some(code => raw.startsWith(code))
                    targetPhone = (isUS ? '1' : '91') + raw
                }
                
                // Prepare Interakt payload
                const payload: any = {
                    fullPhoneNumber: '+' + targetPhone,
                    type: messageType === 'text' ? 'Text' : 
                          messageType.charAt(0).toUpperCase() + messageType.slice(1),
                    data: {}
                }

                if (messageType === 'text') {
                    payload.data.message = content
                } else {
                    payload.data.mediaUrl = mediaUrl
                    if (content) payload.data.message = content // Caption
                }

                const response = await fetch('https://api.interakt.ai/v1/public/message/', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${INTERAKT_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                })

                const result = await response.json()
                if (result.result) {
                    interaktMessageId = result.id
                } else {
                    console.error('Interakt API Error:', result)
                    return { success: false, error: result.message || 'Interakt API failed' }
                }
            } catch (error: any) {
                console.error('Failed to call Interakt API:', error)
                return { success: false, error: error.message }
            }
        } else {
            return { success: false, error: 'Interakt API Key missing' }
        }

        if (!conversation || !conversation.id) throw new Error('Conversation not available')

        const { data: message, error: msgError } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversation.id,
                organization_id: lead.organization_id,
                sender_type: 'agent',
                message_type: messageType,
                content: content || null,
                media_url: mediaUrl || null,
                interakt_message_id: interaktMessageId,
                status: interaktMessageId ? 'sent' : 'failed'
            })
            .select()
            .single()

        if (msgError) return { success: false, error: 'Database error: ' + msgError.message }

        // 5. Update conversation last activity
        await supabase.from('conversations').update({
            last_customer_message_at: new Date().toISOString()
        }).eq('id', conversation.id)

        // 6. Log activity
        await supabase.from('activity_logs').insert({
            organization_id: lead.organization_id,
            action: 'whatsapp',
            details: mediaUrl ? `Sent Media (${messageType}): ${mediaUrl}` : `Sent WhatsApp: ${content}`,
            lead_id: leadId
        })

        revalidatePath(`/leads/${leadId}`)
        revalidatePath('/inbox')
        
        return { success: true, message }
    } catch (e: any) {
        console.error('sendWhatsAppMessage error:', e)
        return { success: false, error: e.message }
    }
}

export async function sendWhatsAppTemplateForLead(
    leadId: string,
    templateName?: string,
    bodyValues: string[] = []
) {
    try {
        const supabase = await createClient()

        const effectiveTemplate = templateName || INTERAKT_FB_TEMPLATE_NAME
        if (!effectiveTemplate) {
            console.error('sendWhatsAppTemplateForLead: template name is not configured')
            return { success: false, error: 'Template name not configured' }
        }

        const { data: lead, error: leadError } = await supabase
            .from('leads')
            .select('phone_number, organization_id')
            .eq('id', leadId)
            .single()

        if (leadError || !lead) throw new Error('Lead not found')

        let { data: conversation } = await supabase
            .from('conversations')
            .select('id')
            .eq('lead_id', leadId)
            .maybeSingle()

        if (!conversation || !conversation.id) {
            const { data: newConv, error: createConvError } = await supabase
                .from('conversations')
                .insert({
                    organization_id: lead.organization_id,
                    lead_id: leadId,
                    unread_count: 0,
                })
                .select()
                .single()

            if (createConvError) throw createConvError
            if (!newConv) throw new Error('Failed to create conversation')
            conversation = newConv
        }

        let interaktMessageId: string | null = null

        if (!INTERAKT_API_KEY) {
            return { success: false, error: 'Interakt API Key missing' }
        }

        // Reuse the same phone normalisation as sendWhatsAppMessage
        let raw = (lead.phone_number || '').replace(/\+/g, '')
        let targetPhone = raw

        if (raw.length === 10) {
            const usAreaCodes = ['562', '631', '267', '980', '240', '484', '864']
            const isUS = usAreaCodes.some((code) => raw.startsWith(code))
            targetPhone = (isUS ? '1' : '91') + raw
        }

        const payload: any = {
            fullPhoneNumber: '+' + targetPhone,
            type: 'Template',
            templateName: effectiveTemplate,
            languageCode: INTERAKT_FB_TEMPLATE_LANG,
            bodyValues,
        }

        try {
            const response = await fetch('https://api.interakt.ai/v1/public/message/', {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${INTERAKT_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            })

            const result = await response.json()
            if (result.result) {
                interaktMessageId = result.id
            } else {
                console.error('Interakt Template API Error:', result)
                return { success: false, error: result.message || 'Interakt template API failed' }
            }
        } catch (error: any) {
            console.error('Failed to call Interakt Template API:', error)
            return { success: false, error: error.message }
        }

        if (!conversation || !conversation.id) throw new Error('Conversation not available')

        const previewContent = `Template: ${effectiveTemplate}`

        const { data: message, error: msgError } = await supabase
            .from('messages')
            .insert({
                conversation_id: conversation.id,
                organization_id: lead.organization_id,
                sender_type: 'agent',
                message_type: 'text',
                content: previewContent,
                media_url: null,
                interakt_message_id: interaktMessageId,
                status: interaktMessageId ? 'sent' : 'failed',
            })
            .select()
            .single()

        if (msgError) return { success: false, error: 'Database error: ' + msgError.message }

        await supabase
            .from('conversations')
            .update({ last_customer_message_at: new Date().toISOString() })
            .eq('id', conversation.id)

        await supabase.from('activity_logs').insert({
            organization_id: lead.organization_id,
            action: 'whatsapp',
            details: `Sent WhatsApp template: ${effectiveTemplate}`,
            lead_id: leadId,
        })

        revalidatePath(`/leads/${leadId}`)
        revalidatePath('/inbox')

        return { success: true, message }
    } catch (e: any) {
        console.error('sendWhatsAppTemplateForLead error:', e)
        return { success: false, error: e.message }
    }
}

export async function getConversations() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('conversations')
    .select(`
      *,
      leads(id, name, contact_person, phone_number),
      messages(content, created_at, sender_type)
    `)
    .order('last_customer_message_at', { ascending: false })
  
  if (error) throw error
  
  // Map to include only the latest message
  return data.map(conv => ({
    ...conv,
    last_message: conv.messages?.sort((a: any, b: any) => 
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0] || null
  }))
}

export async function getMessages(conversationId: string, limit = 50, offset = 0) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  
  if (error) throw error
  return data.reverse() // Return in chronological order for the UI
}

export async function markAsRead(conversationId: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('conversations')
    .update({ unread_count: 0 })
    .eq('id', conversationId)
  
  if (error) throw error
  revalidatePath('/inbox')
  return { success: true }
}

export async function syncInteraktData() {
    const supabase = await createClient()
    const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY

    if (!INTERAKT_API_KEY) return { success: false, error: 'Interakt API key not configured' }
    
    try {
        const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
        if (!org) throw new Error('No organization found')

        // Paginate through all Interakt customers
        let offset = 0
        const limit = 100
        let allCustomers: any[] = []
        let total = 0

        do {
            const response = await fetch(`https://api.interakt.ai/v1/public/apis/users/?offset=${offset}&limit=${limit}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${INTERAKT_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filters: [{ trait: 'created_at_utc', op: 'gt', val: '2020-01-01T00:00:00Z' }]
                })
            })

            if (!response.ok) throw new Error(`Interakt API error: ${response.status}`)

            const result = await response.json()
            const customers = result.data?.customers || []
            total = result.data?.total_customers || 0
            allCustomers.push(...customers)
            offset += limit
        } while (offset < total)

        let syncCount = 0
        for (const candidate of allCustomers) {
            const traits = candidate.traits || {}
            const fullName = traits.name || candidate.full_name || 'WhatsApp Lead'

            // Be more forgiving with phone sources & formats (mirrors scripts/sync_interakt_leads.mjs)
            const phoneFromApi = candidate.phone_number || traits.phone_number || traits.phone
            if (!phoneFromApi) {
                continue
            }

            // Normalise to the 10‑digit format we store in CRM (strip + and leading 91)
            const normalisedPhone = String(phoneFromApi).replace(/\+/g, '').replace(/^91/, '')
            if (!normalisedPhone) {
                continue
            }

            // Find or create lead
            let { data: existingLead } = await supabase
                .from('leads')
                .select('id, organization_id')
                .eq('phone_number', normalisedPhone)
                .limit(1)
                .maybeSingle()

            let leadId = existingLead?.id
            if (!leadId) {
                const { data: created, error: createErr } = await supabase
                    .from('leads')
                    .insert({
                        organization_id: org.id,
                        name: fullName,
                        contact_person: fullName,
                        phone_number: normalisedPhone,
                        source: 'WhatsApp',
                        temperature: 'warm'
                    })
                    .select('id')
                    .single()
                if (createErr) { console.error('Failed to insert lead:', createErr.message); continue }
                leadId = created?.id
            }

            if (!leadId) continue

            // Find or create conversation
            const { data: conv } = await supabase
                .from('conversations')
                .select('id')
                .eq('lead_id', leadId)
                .limit(1)
                .maybeSingle()

            const lastActivity = candidate.modified_at_utc || candidate.created_at_utc || new Date().toISOString()

            if (!conv) {
                await supabase.from('conversations').insert({
                    organization_id: org.id,
                    lead_id: leadId,
                    unread_count: 1,
                    last_customer_message_at: lastActivity
                })
            } else {
                await supabase.from('conversations')
                    .update({ last_customer_message_at: lastActivity })
                    .eq('id', conv.id)
            }

            syncCount++
        }

        revalidatePath('/inbox')
        return { success: true, count: syncCount }
    } catch (e: any) {
        console.error('Sync error:', e)
        return { success: false, error: e.message }
    }
}

export async function syncLeadMessages(leadId: string) {
    const supabase = await createClient()
    const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY

    try {
        const { data: lead, error: leadError } = await supabase
            .from('leads')
            .select('phone_number, organization_id')
            .eq('id', leadId)
            .single()

        if (leadError || !lead) throw new Error('Lead not found')

        // Normalize phone for Interakt
        let raw = lead.phone_number.replace(/\+/g, '')
        let targetPhone = raw
        if (raw.length === 10) {
            targetPhone = '91' + raw // Default to India for now or detect
        }

        // Fetch this specific user details from Interakt
        // Note: Interakt public API doesn't have a direct "get messages" without webhooks
        // so we poll the user details and check if there's any last message indicator
        const response = await fetch(`https://api.interakt.ai/v1/public/apis/users/?offset=0&limit=1`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${INTERAKT_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                filters: [
                    { trait: 'phone_number', op: 'eq', val: '+' + targetPhone }
                ]
            })
        })

        if (!response.ok) throw new Error('Interakt API error')
        const result = await response.json()
        const customer = result.data?.customers?.[0]

        if (customer) {
            // Update conversation last activity
            await supabase.from('conversations')
                .update({ last_customer_message_at: customer.updated_at_utc || new Date().toISOString() })
                .eq('lead_id', leadId)
        }

        revalidatePath('/inbox')
        revalidatePath(`/leads/${leadId}`)
        return { success: true }
    } catch (e: any) {
        console.error('syncLeadMessages error:', e)
        return { success: false, error: e.message }
    }
}
