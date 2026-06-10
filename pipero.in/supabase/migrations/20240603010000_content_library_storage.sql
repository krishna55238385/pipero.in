-- Storage setup for Content Library uploads (pdf, creatives, docs, media)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-library',
  'content-library',
  true,
  104857600,
  ARRAY[
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
    'video/webm'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Public bucket simplifies local/dev. If your project enforces strict access, replace with authenticated policies.
CREATE POLICY IF NOT EXISTS "content_library_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'content-library');

CREATE POLICY IF NOT EXISTS "content_library_public_insert"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'content-library');

CREATE POLICY IF NOT EXISTS "content_library_public_update"
ON storage.objects FOR UPDATE
USING (bucket_id = 'content-library')
WITH CHECK (bucket_id = 'content-library');

CREATE POLICY IF NOT EXISTS "content_library_public_delete"
ON storage.objects FOR DELETE
USING (bucket_id = 'content-library');

