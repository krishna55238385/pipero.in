import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
    'https://xhjxpesdvcrensccdydh.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhoanhwZXNkdmNyZW5zY2NkeWRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIxMzE2OTEsImV4cCI6MjA4NzcwNzY5MX0.CsuCVQMuS76PtdN82tFNMaBJk2bINngyvt9rcdZbDGk'
)

async function test() {
    const userId = '1308a9f6-2bf4-4903-a1df-b6b669e4ceb1' // just a dummy uuid
    // Test .or syntax
    const { data, error } = await supabase.from('leads').select('name, owner_id').or(`owner_id.eq.${userId},owner_id.is.null`)
    console.log('Error:', error)
    console.log('Returned leads count:', data?.length)
}
test()
