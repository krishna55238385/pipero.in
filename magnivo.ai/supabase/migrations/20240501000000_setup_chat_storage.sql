-- Create the storage bucket for chat attachments if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Set up access policy for the bucket (allowing all for now since the CRM has RLS disabled/relaxed for dev)
CREATE POLICY "Public Access" ON storage.objects FOR ALL USING (bucket_id = 'chat-attachments');
