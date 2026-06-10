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

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;

async function syncLeads() {
    console.log('--- Syncing Interakt Contacts ---');

    const url = 'https://api.interakt.ai/v1/public/apis/users/?offset=0&limit=100';

    try {
        const payload = {
            filters: [
                {
                    trait: "created_at_utc",
                    op: "gt",
                    val: "2020-01-01T00:00:00Z"
                }
            ]
        };

        console.log('Sending request to Interakt...');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${INTERAKT_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to fetch from Interakt (Status ${response.status}):`, errorText);
            return;
        }

        const result = await response.json();
        const candidates = result.data?.customers || [];

        if (!candidates || !Array.isArray(candidates)) {
            console.error('Could NOT find a list of contacts in the API response.');
            return;
        }

        console.log(`Found ${candidates.length} contacts in Interakt.`);

        const { data: org } = await supabase.from('organizations').select('id').limit(1).single();
        if (!org) {
            console.error('No organization found in CRM.');
            return;
        }

        for (const candidate of candidates) {
            const traits = candidate.traits || {};
            const fullName = candidate.full_name || traits.name || traits.full_name || 'WhatsApp Lead';
            const phoneNumber = candidate.phone_number || traits.phone_number || traits.phone;

            if (!phoneNumber) continue;

            const rawPhone = phoneNumber.replace(/\+/g, '').replace(/^91/, '');
            console.log(`Syncing: ${fullName} (${rawPhone})`);

            // 1. Manual Upsert Check
            let { data: existingLead } = await supabase
                .from('leads')
                .select('id')
                .eq('phone_number', rawPhone)
                .limit(1)
                .single();

            let leadId;
            if (existingLead) {
                console.log(`Lead exists (${existingLead.id}), updating...`);
                const { data: updatedLead, error: updateError } = await supabase
                    .from('leads')
                    .update({
                        name: fullName,
                        contact_person: fullName
                    })
                    .eq('id', existingLead.id)
                    .select()
                    .single();

                if (updateError) {
                    console.error(`Error updating lead ${rawPhone}:`, updateError);
                    continue;
                }
                leadId = updatedLead.id;
            } else {
                console.log(`Lead is new, inserting...`);
                const { data: newLead, error: insertError } = await supabase
                    .from('leads')
                    .insert({
                        organization_id: org.id,
                        name: fullName,
                        contact_person: fullName,
                        phone_number: rawPhone,
                        source: 'WhatsApp'
                    })
                    .select()
                    .single();

                if (insertError) {
                    console.error(`Error inserting lead ${rawPhone}:`, insertError);
                    continue;
                }
                leadId = newLead.id;
            }

            // 2. Ensure Conversation exists
            const { data: conv } = await supabase
                .from('conversations')
                .select('id')
                .eq('lead_id', leadId)
                .limit(1)
                .single();

            if (!conv) {
                await supabase.from('conversations').insert({
                    organization_id: org.id,
                    lead_id: leadId,
                    unread_count: 0,
                    last_customer_message_at: candidate.created_at_utc || new Date().toISOString()
                });
                console.log(`Created conversation for ${fullName}`);
            }
        }

        console.log('--- Sync Complete ---');
    } catch (err) {
        console.error('Sync process failed:', err);
    }
}

syncLeads();
