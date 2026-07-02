'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { uploadFile } from '@/lib/s3'

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY
const INTERAKT_FB_TEMPLATE_NAME = process.env.INTERAKT_FB_TEMPLATE_NAME
const INTERAKT_FB_TEMPLATE_LANG = process.env.INTERAKT_FB_TEMPLATE_LANG || 'en'

/** Uploads a chat attachment picked in the composer and returns its public URL. */
export async function uploadChatAttachment(file: File, leadId: string) {
  try {
    const fileExt = file.name.split('.').pop()
    const fileName = `${Math.random()}.${fileExt}`
    const filePath = `${leadId}/${fileName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const url = await uploadFile(buffer, `chat-attachments/${filePath}`, file.type || 'application/octet-stream')
    return { success: true, url }
  } catch (e: any) {
    return { success: false, error: e?.message || 'Upload failed' }
  }
}

export async function sendWhatsAppMessage(
  leadId: string,
  content: string,
  messageType: 'text' | 'image' | 'document' | 'video' | 'audio' = 'text',
  mediaUrl?: string
) {
  try {
    const leadRes = await pool.query(
      'SELECT phone_number, organization_id FROM public.leads WHERE id = $1 LIMIT 1', [leadId])
    const lead = leadRes.rows[0]
    if (!lead) throw new Error('Lead not found')

    let convRes = await pool.query(
      'SELECT id FROM public.conversations WHERE lead_id = $1 LIMIT 1', [leadId])
    let conversation = convRes.rows[0]

    if (!conversation) {
      const newConv = await pool.query(
        'INSERT INTO public.conversations (organization_id, lead_id, unread_count) VALUES ($1,$2,0) RETURNING *',
        [lead.organization_id, leadId])
      conversation = newConv.rows[0]
      if (!conversation) throw new Error('Failed to create conversation')
    }

    if (!INTERAKT_API_KEY) return { success: false, error: 'Interakt API Key missing' }

    let raw = lead.phone_number.replace(/\+/g, '')
    let targetPhone = raw
    if (raw.length === 10) {
      const usAreaCodes = ['562', '631', '267', '980', '240', '484', '864']
      const isUS = usAreaCodes.some((code: string) => raw.startsWith(code))
      targetPhone = (isUS ? '1' : '91') + raw
    }

    const payload: any = {
      fullPhoneNumber: '+' + targetPhone,
      type: messageType === 'text' ? 'Text' : messageType.charAt(0).toUpperCase() + messageType.slice(1),
      data: {}
    }
    if (messageType === 'text') { payload.data.message = content }
    else { payload.data.mediaUrl = mediaUrl; if (content) payload.data.message = content }

    let interaktMessageId = null
    try {
      const response = await fetch('https://api.interakt.ai/v1/public/message/', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${INTERAKT_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const result = await response.json()
      if (result.result) { interaktMessageId = result.id }
      else { console.error('Interakt API Error:', result); return { success: false, error: result.message || 'Interakt API failed' } }
    } catch (error: any) {
      console.error('Failed to call Interakt API:', error)
      return { success: false, error: error.message }
    }

    const msgRes = await pool.query(
      `INSERT INTO public.messages (conversation_id, organization_id, sender_type, message_type, content, media_url, interakt_message_id, status)
       VALUES ($1,$2,'agent',$3,$4,$5,$6,$7) RETURNING *`,
      [conversation.id, lead.organization_id, messageType, content || null, mediaUrl || null, interaktMessageId, interaktMessageId ? 'sent' : 'failed'])
    const message = msgRes.rows[0]

    await pool.query(
      'UPDATE public.conversations SET last_customer_message_at = $1 WHERE id = $2',
      [new Date().toISOString(), conversation.id])

    await pool.query(
      'INSERT INTO public.activity_logs (organization_id, action, details, lead_id) VALUES ($1,$2,$3,$4)',
      [lead.organization_id, 'whatsapp', mediaUrl ? `Sent Media (${messageType}): ${mediaUrl}` : `Sent WhatsApp: ${content}`, leadId])

    revalidatePath(`/leads/${leadId}`); revalidatePath('/inbox')
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
    const effectiveTemplate = templateName || INTERAKT_FB_TEMPLATE_NAME
    if (!effectiveTemplate) return { success: false, error: 'Template name not configured' }

    const leadRes = await pool.query(
      'SELECT phone_number, organization_id FROM public.leads WHERE id = $1 LIMIT 1', [leadId])
    const lead = leadRes.rows[0]
    if (!lead) throw new Error('Lead not found')

    let convRes = await pool.query('SELECT id FROM public.conversations WHERE lead_id = $1 LIMIT 1', [leadId])
    let conversation = convRes.rows[0]

    if (!conversation) {
      const newConv = await pool.query(
        'INSERT INTO public.conversations (organization_id, lead_id, unread_count) VALUES ($1,$2,0) RETURNING *',
        [lead.organization_id, leadId])
      conversation = newConv.rows[0]
      if (!conversation) throw new Error('Failed to create conversation')
    }

    if (!INTERAKT_API_KEY) return { success: false, error: 'Interakt API Key missing' }

    let raw = (lead.phone_number || '').replace(/\+/g, '')
    let targetPhone = raw
    if (raw.length === 10) {
      const usAreaCodes = ['562', '631', '267', '980', '240', '484', '864']
      const isUS = usAreaCodes.some((code: string) => raw.startsWith(code))
      targetPhone = (isUS ? '1' : '91') + raw
    }

    const payload: any = {
      fullPhoneNumber: '+' + targetPhone,
      type: 'Template',
      templateName: effectiveTemplate,
      languageCode: INTERAKT_FB_TEMPLATE_LANG,
      bodyValues,
    }

    let interaktMessageId: string | null = null
    try {
      const response = await fetch('https://api.interakt.ai/v1/public/message/', {
        method: 'POST',
        headers: { Authorization: `Basic ${INTERAKT_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (result.result) { interaktMessageId = result.id }
      else { console.error('Interakt Template API Error:', result); return { success: false, error: result.message || 'Interakt template API failed' } }
    } catch (error: any) {
      console.error('Failed to call Interakt Template API:', error)
      return { success: false, error: error.message }
    }

    const previewContent = `Template: ${effectiveTemplate}`
    const msgRes = await pool.query(
      `INSERT INTO public.messages (conversation_id, organization_id, sender_type, message_type, content, media_url, interakt_message_id, status)
       VALUES ($1,$2,'agent','text',$3,NULL,$4,$5) RETURNING *`,
      [conversation.id, lead.organization_id, previewContent, interaktMessageId, interaktMessageId ? 'sent' : 'failed'])
    const message = msgRes.rows[0]

    await pool.query(
      'UPDATE public.conversations SET last_customer_message_at = $1 WHERE id = $2',
      [new Date().toISOString(), conversation.id])

    await pool.query(
      'INSERT INTO public.activity_logs (organization_id, action, details, lead_id) VALUES ($1,$2,$3,$4)',
      [lead.organization_id, 'whatsapp', `Sent WhatsApp template: ${effectiveTemplate}`, leadId])

    revalidatePath(`/leads/${leadId}`); revalidatePath('/inbox')
    return { success: true, message }
  } catch (e: any) {
    console.error('sendWhatsAppTemplateForLead error:', e)
    return { success: false, error: e.message }
  }
}

export async function getConversations() {
  try {
    const result = await pool.query(`
      SELECT c.*,
        json_build_object('id', l.id, 'name', l.name, 'contact_person', l.contact_person, 'phone_number', l.phone_number) AS leads,
        COALESCE((
          SELECT json_agg(json_build_object('content', m.content, 'created_at', m.created_at, 'sender_type', m.sender_type) ORDER BY m.created_at DESC)
          FROM public.messages m WHERE m.conversation_id = c.id
        ), '[]'::json) AS messages
      FROM public.conversations c
      LEFT JOIN public.leads l ON l.id = c.lead_id
      ORDER BY c.last_customer_message_at DESC
    `)
    return result.rows.map((conv: any) => ({
      ...conv,
      last_message: Array.isArray(conv.messages) ? conv.messages[0] || null : null
    }))
  } catch (err: any) { throw new Error(err.message) }
}

export async function getMessages(conversationId: string, limit = 50, offset = 0) {
  try {
    const result = await pool.query(
      'SELECT * FROM public.messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [conversationId, limit, offset])
    return result.rows.reverse()
  } catch (err: any) { throw new Error(err.message) }
}

export async function markAsRead(conversationId: string) {
  try {
    await pool.query('UPDATE public.conversations SET unread_count = 0 WHERE id = $1', [conversationId])
    revalidatePath('/inbox')
    return { success: true }
  } catch (err: any) { throw new Error(err.message) }
}

export async function syncInteraktData() {
  const API_KEY = process.env.INTERAKT_API_KEY
  if (!API_KEY) return { success: false, error: 'Interakt API key not configured' }

  try {
    const orgRes = await pool.query('SELECT id FROM public.organizations LIMIT 1')
    const org = orgRes.rows[0]
    if (!org) throw new Error('No organization found')

    let offset = 0; const limit = 100; let allCustomers: any[] = []; let total = 0
    do {
      const response = await fetch(`https://api.interakt.ai/v1/public/apis/users/?offset=${offset}&limit=${limit}`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: [{ trait: 'created_at_utc', op: 'gt', val: '2020-01-01T00:00:00Z' }] })
      })
      if (!response.ok) throw new Error(`Interakt API error: ${response.status}`)
      const result = await response.json()
      const customers = result.data?.customers || []
      total = result.data?.total_customers || 0
      allCustomers.push(...customers); offset += limit
    } while (offset < total)

    let syncCount = 0
    for (const candidate of allCustomers) {
      const traits = candidate.traits || {}
      const fullName = traits.name || candidate.full_name || 'WhatsApp Lead'
      const phoneFromApi = candidate.phone_number || traits.phone_number || traits.phone
      if (!phoneFromApi) continue
      const normalisedPhone = String(phoneFromApi).replace(/\+/g, '').replace(/^91/, '')
      if (!normalisedPhone) continue

      let existingRes = await pool.query(
        'SELECT id, organization_id FROM public.leads WHERE phone_number = $1 LIMIT 1', [normalisedPhone])
      let leadId = existingRes.rows[0]?.id

      if (!leadId) {
        try {
          const created = await pool.query(
            `INSERT INTO public.leads (organization_id, name, contact_person, phone_number, source, temperature)
             VALUES ($1,$2,$3,$4,'WhatsApp','warm') RETURNING id`,
            [org.id, fullName, fullName, normalisedPhone])
          leadId = created.rows[0]?.id
        } catch (createErr: any) { console.error('Failed to insert lead:', createErr.message); continue }
      }

      if (!leadId) continue

      const convRes = await pool.query('SELECT id FROM public.conversations WHERE lead_id = $1 LIMIT 1', [leadId])
      const conv = convRes.rows[0]
      const lastActivity = candidate.modified_at_utc || candidate.created_at_utc || new Date().toISOString()

      if (!conv) {
        await pool.query(
          'INSERT INTO public.conversations (organization_id, lead_id, unread_count, last_customer_message_at) VALUES ($1,$2,1,$3)',
          [org.id, leadId, lastActivity])
      } else {
        await pool.query(
          'UPDATE public.conversations SET last_customer_message_at = $1 WHERE id = $2',
          [lastActivity, conv.id])
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
  const API_KEY = process.env.INTERAKT_API_KEY
  try {
    const leadRes = await pool.query(
      'SELECT phone_number, organization_id FROM public.leads WHERE id = $1 LIMIT 1', [leadId])
    const lead = leadRes.rows[0]
    if (!lead) throw new Error('Lead not found')

    let raw = lead.phone_number.replace(/\+/g, '')
    let targetPhone = raw
    if (raw.length === 10) targetPhone = '91' + raw

    const response = await fetch(`https://api.interakt.ai/v1/public/apis/users/?offset=0&limit=1`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filters: [{ trait: 'phone_number', op: 'eq', val: '+' + targetPhone }] })
    })
    if (!response.ok) throw new Error('Interakt API error')
    const result = await response.json()
    const customer = result.data?.customers?.[0]

    if (customer) {
      await pool.query(
        'UPDATE public.conversations SET last_customer_message_at = $1 WHERE lead_id = $2',
        [customer.updated_at_utc || new Date().toISOString(), leadId])
    }

    revalidatePath('/inbox'); revalidatePath(`/leads/${leadId}`)
    return { success: true }
  } catch (e: any) {
    console.error('syncLeadMessages error:', e)
    return { success: false, error: e.message }
  }
}
