import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    'https://xhjxpesdvcrensccdydh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoanhwZXNkdmNyZW5zY2NkeWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzE2OTEsImV4cCI6MjA4NzcwNzY5MX0.CsuCVQMuS76PtdN82tFNMaBJk2bINngyvt9rcdZbDGk'
)

async function debugGetLeads() {
    const orgId = '57e4b2bc-a802-4406-b981-de1658ce09f6'

    let query = supabase
        .from('leads')
        .select('*, deals(id, value, status), tasks(id, status)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })

    const { data, error } = await query
    console.log('Returned rows:', data?.length)
    console.log('Error:', error)
}
debugGetLeads()
