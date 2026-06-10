-- Enable Realtime for conversations and messages
begin;
  alter publication supabase_realtime add table conversations;
  alter publication supabase_realtime add table messages;
  
  -- ensure full payload on updates
  ALTER TABLE public.conversations REPLICA IDENTITY FULL;
  ALTER TABLE public.messages REPLICA IDENTITY FULL;
commit;
