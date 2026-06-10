import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateText } from '@/lib/llm'

export const maxDuration = 60

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
])

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function bytesToText(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  } catch {
    return ''
  }
}

async function summarizeWithAI(fileBytes: Uint8Array, mimeType: string, fallbackText?: string) {
  try {
    const base64 = Buffer.from(fileBytes).toString('base64')
    const prompt = [
      'Extract key useful business content from this file for CRM content library indexing.',
      'Return JSON with keys: extracted_text (string), summary (string), tags (array of strings).',
      'If text extraction is weak, still provide best-effort summary.',
      fallbackText ? `Hint text from parser:\n${fallbackText.slice(0, 12000)}` : '',
    ].filter(Boolean).join('\n\n')

    const text = await generateText(
      `${prompt}\n\nMIME:${mimeType}\nBASE64_LENGTH:${base64.length}\n` +
      'Use the provided file data context to infer content.',
      'content_upload_ai'
    )

    // Best effort parse
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(cleaned)
    return {
      extractedText: String(parsed.extracted_text || '').trim(),
      summary: String(parsed.summary || '').trim(),
      tags: Array.isArray(parsed.tags) ? parsed.tags.map((t: unknown) => String(t)).filter(Boolean) : [],
    }
  } catch {
    return {
      extractedText: fallbackText || '',
      summary: '',
      tags: [],
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'file is required' }, { status: 400 })
    }

    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json({ success: false, error: `Unsupported file type: ${file.type}` }, { status: 400 })
    }

    const { data: org } = await supabase.from('organizations').select('id').limit(1).single()
    if (!org?.id) {
      return NextResponse.json({ success: false, error: 'No organization found' }, { status: 400 })
    }

    const ab = await file.arrayBuffer()
    const bytes = new Uint8Array(ab)
    const textLike = file.type.startsWith('text/') || file.type === 'application/json'
    const parsedText = textLike ? bytesToText(bytes) : ''

    const ymd = new Date().toISOString().slice(0, 10)
    const safeName = sanitizeFileName(file.name || 'upload')
    const path = `${org.id}/${ymd}/${Date.now()}_${safeName}`

    const { error: uploadError } = await supabase
      .storage
      .from('content-library')
      .upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' })

    if (uploadError) {
      return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 })
    }

    const { data: publicUrlData } = supabase.storage.from('content-library').getPublicUrl(path)

    const ai = await summarizeWithAI(bytes, file.type, parsedText)

    return NextResponse.json({
      success: true,
      file: {
        name: file.name,
        size: file.size,
        mime_type: file.type,
        path,
        public_url: publicUrlData?.publicUrl || null,
      },
      extracted_text: ai.extractedText || parsedText || '',
      summary: ai.summary || '',
      suggested_tags: ai.tags || [],
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Upload failed' }, { status: 500 })
  }
}

