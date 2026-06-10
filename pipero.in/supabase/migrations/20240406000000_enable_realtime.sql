-- Enable Supabase Realtime for specific tables
begin;
  -- remove the supabase_realtime publication
  drop publication if exists supabase_realtime;

  -- re-create the supabase_realtime publication
  create publication supabase_realtime;
commit;

-- add tables to the publication
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table deals;
alter publication supabase_realtime add table tasks;
