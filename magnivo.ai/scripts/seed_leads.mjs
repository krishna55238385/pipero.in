import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env.local')
    process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

const sampleLeads = [
    {
        name: 'Acme Corp',
        contact_person: 'Wile E. Coyote',
        phone_number: '1234567890',
        location: 'Desert Valley',
        temperature: 'hot',
        source: 'Website',
        status: 'New'
    },
    {
        name: 'Stark Industries',
        contact_person: 'Tony Stark',
        phone_number: '9876543210',
        location: 'New York',
        temperature: 'warm',
        source: 'Referral',
        status: 'Contacted'
    },
    {
        name: 'Wayne Enterprises',
        contact_person: 'Bruce Wayne',
        phone_number: '5550123456',
        location: 'Gotham',
        temperature: 'cold',
        source: 'Cold Call',
        status: 'Qualified'
    },
    {
        name: 'Pied Piper',
        contact_person: 'Richard Hendricks',
        phone_number: '4155552671',
        location: 'Silicon Valley',
        temperature: 'hot',
        source: 'Event',
        status: 'New'
    },
    {
        name: 'Massive Dynamic',
        contact_person: 'Nina Sharp',
        phone_number: '6175550192',
        location: 'Boston',
        temperature: 'warm',
        source: 'Partner',
        status: 'Proposal'
    }
]

async function seedLeads() {
    console.log('Starting to seed sample leads...')

    const { data: orgs, error: orgError } = await supabase.from('organizations').select('id').limit(1)

    if (orgError || !orgs || orgs.length === 0) {
        console.error('Failed to fetch organization:', orgError)
        process.exit(1)
    }

    const orgId = orgs[0].id
    console.log(`Found organization: ${orgId}`)

    const leadsToInsert = sampleLeads.map(lead => ({
        ...lead,
        organization_id: orgId
    }))

    const { data, error } = await supabase
        .from('leads')
        .insert(leadsToInsert)
        .select()

    if (error) {
        console.error('Error inserting leads:', error)
    } else {
        console.log(`Successfully added ${data.length} sample leads!`)
    }
}

seedLeads()
