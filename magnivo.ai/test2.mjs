import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    'https://xhjxpesdvcrensccdydh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoanhwZXNkdmNyZW5zY2NkeWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzE2OTEsImV4cCI6MjA4NzcwNzY5MX0.CsuCVQMuS76PtdN82tFNMaBJk2bINngyvt9rcdZbDGk'
)

async function debugLeads() {
    const { data: orgs } = await supabase.from('organizations').select('*')
    console.log('Orgs:', orgs)

    const { data: leads } = await supabase.from('leads').select('id, name, organization_id, owner_id')
    console.log('Leads:', leads)
}
debugLeads()
