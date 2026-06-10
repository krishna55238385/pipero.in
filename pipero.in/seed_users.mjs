
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function seed() {
    const { data: orgs } = await supabase.from('organizations').select('id').limit(1).single()
    if (!orgs) {
        console.log('No org found')
        return
    }

    const orgId = orgs.id

    const demoUsers = [
        {
            organization_id: orgId,
            full_name: 'Demo Admin',
            role: 'admin',
            id: 'd9e0f124-c8c2-4a0b-967a-123456789012'
        },
        {
            organization_id: orgId,
            full_name: 'Sales Rep 1',
            role: 'user',
            id: 'e1234567-c8c2-4a0b-967a-123456789013'
        },
        {
            organization_id: orgId,
            full_name: 'Sales Rep 2',
            role: 'user',
            id: 'f7894561-c8c2-4a0b-967a-123456789014'
        }
    ]

    const { error } = await supabase.from('users').upsert(demoUsers)
    if (error) console.error('Error seeding users:', error)
    else console.log('Successfully seeded users')
}

seed()
