import { NextRequest, NextResponse } from 'next/server'
import { ATTACHMENTS_BUCKET, MAX_ATTACHMENT_BYTES } from '@/lib/engage-attachments'
import { uploadFile } from '@/lib/s3'

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

    await uploadFile(
      Buffer.from(await file.arrayBuffer()),
      `${ATTACHMENTS_BUCKET}/${path}`,
      file.type || 'application/octet-stream',
    )

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
