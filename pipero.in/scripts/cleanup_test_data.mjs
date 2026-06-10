import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function cleanup() {
    console.log('--- Aggressive Cleanup of Mock Data ---');

    // 1. Delete all messages that look like tests or samples
    const { error: msgError, count: msgCount } = await supabase
        .from('messages')
        .delete({ count: 'exact' })
        .or('content.ilike.%test script%,content.ilike.%mock%,content.ilike.%sample%');

    if (msgError) console.error('Error deleting messages:', msgError);
    else console.log(`Deleted ${msgCount} mock/test messages.`);

    // 2. Delete Leads that are obviously mock or samples
    const { error: leadError, count: leadCount } = await supabase
        .from('leads')
        .delete({ count: 'exact' })
        .or('name.ilike.%[Sample]%,name.ilike.%Test%,name.eq.Any Name,name.eq.John Doe,name.eq.WhatsApp Lead');

    if (leadError) console.error('Error deleting leads:', leadError);
    else console.log(`Deleted ${leadCount} mock leads.`);

    // 3. Delete conversations that have no leads (should be handled by cascade, but just in case)
    // Or better, delete conversations associated with orphaned leads if any.

    console.log('--- Cleanup Complete ---');
}

cleanup();
