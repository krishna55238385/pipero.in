-- Attachment uploads failed with "new row violates row-level security policy"
-- because storage.objects keeps RLS on (unlike the public.* tables, which run
-- RLS-disabled in this single-tenant deployment) and the app's "service" client
-- uses the anon key. Allow CRUD on the private engage-attachments bucket for the
-- anon + authenticated roles so the server upload/download routes work. Scoped
-- to this one bucket only.
DROP POLICY IF EXISTS engage_attachments_rw ON storage.objects;
CREATE POLICY engage_attachments_rw ON storage.objects
  FOR ALL
  TO anon, authenticated
  USING (bucket_id = 'engage-attachments')
  WITH CHECK (bucket_id = 'engage-attachments');
