import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ATTACHMENTS_BUCKET, MAX_ATTACHMENT_BYTES } from '@/lib/engage-attachments'

// Uploads a composer/template attachment into private storage and returns the
// metadata the send/template APIs expect ({ path, filename, mimeType, size }).
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json(
        { error: `File exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB limit` },
        { status: 413 },
      )
    }

    const safeName = (file.name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120)
    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}/${safeName}`

    const supabase = createServiceClient()
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      })
    if (error) throw new Error(error.message)

    return NextResponse.json({
      attachment: {
        path,
        filename: file.name || safeName,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'upload_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
