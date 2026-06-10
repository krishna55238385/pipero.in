
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function check() {
    const { data: orgs } = await supabase.from('organizations').select('*')
    console.log('Orgs:', orgs)

    if (orgs && orgs.length > 0) {
        const { data: users } = await supabase.from('users').select('*').eq('organization_id', orgs[0].id)
        console.log('Users in first org:', users)
    }
}

check()
