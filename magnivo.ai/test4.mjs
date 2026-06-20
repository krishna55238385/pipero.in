import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    'https://xhjxpesdvcrensccdydh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoanhwZXNkdmNyZW5zY2NkeWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzE2OTEsImV4cCI6MjA4NzcwNzY5MX0.CsuCVQMuS76PtdN82tFNMaBJk2bINngyvt9rcdZbDGk'
)

async function debugGetLeadsUserId() {
    const orgId = '57e4b2bc-a802-4406-b981-de1658ce09f6'
    // Fake user UUID
    const userId = '1308a9f6-2bf4-4903-a1df-b6b669e4ceb1'

    let query = supabase
        .from('leads')
        .select('*, deals(id, value, status), tasks(id, status)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .or(`owner_id.eq.${userId},owner_id.is.null`)

    const { data, error } = await query
    console.log('Returned rows with user ID filter:', data?.length)
    console.log('Error:', error)
}
debugGetLeadsUserId()
