import type { SupabaseClient } from '@supabase/supabase-js'
import type { EngageAttachment } from '@/types/engage'

export const ATTACHMENTS_BUCKET = 'engage-attachments'

// Gmail caps the full MIME message at ~25 MB; stay below it with headroom
// for base64 inflation (~37%).
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

/** Downloads attachment payloads from storage so they can be MIME-embedded. */
export async function loadAttachments(
  supabase: SupabaseClient,
  attachments: EngageAttachment[],
): Promise<Array<{ meta: EngageAttachment; data: Buffer }>> {
  const loaded: Array<{ meta: EngageAttachment; data: Buffer }> = []
  for (const meta of attachments.slice(0, 10)) {
    if (!meta?.path) continue
    const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).download(meta.path)
    if (error || !data) {
      throw new Error(`Attachment "${meta.filename || meta.path}" could not be loaded: ${error?.message ?? 'not found'}`)
    }
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment "${meta.filename}" exceeds the ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB limit`)
    }
    loaded.push({ meta, data: buf })
  }
  return loaded
}
