import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDb() {
    console.log('--- Deep DB Diagnostic ---');

    // 1. Check Organizations
    const { data: orgs } = await supabase.from('organizations').select('id, name');
    console.log('\nOrganizations:');
    orgs?.forEach(o => console.log(` - ${o.name} (${o.id})`));

    // 2. Check Users
    const { data: users } = await supabase.from('users').select('id, full_name, role, organization_id');
    console.log('\nUsers (in public.users):');
    users?.forEach(u => console.log(` - ${u.full_name} (${u.role}) | Org: ${u.organization_id}`));

    // 3. Check Leads
    const { data: leads } = await supabase.from('leads').select('id, name, phone_number, organization_id');
    console.log('\nLeads:');
    leads?.forEach(l => console.log(` - ${l.name} (${l.phone_number}) | Org: ${l.organization_id}`));

    // 4. Check Conversations
    const { data: convs } = await supabase.from('conversations').select('id, lead_id, organization_id, unread_count');
    console.log('\nConversations:');
    convs?.forEach(c => console.log(` - ID: ${c.id} | Lead: ${c.lead_id} | Org: ${c.organization_id} | Unread: ${c.unread_count}`));

    // 5. Check Latest Messages
    const { data: msgs } = await supabase.from('messages').select('id, content, sender_type, organization_id, created_at').order('created_at', { ascending: false }).limit(5);
    console.log('\nLatest Messages:');
    msgs?.forEach(m => console.log(` - [${m.sender_type}] ${m.content} | Org: ${m.organization_id} | at ${m.created_at}`));
}

checkDb();
