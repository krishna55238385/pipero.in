const { Client } = require('pg');

const client = new Client({
    connectionString: "postgresql://postgres.xhjxpesdvcrensccdydh:SSKappu%40123@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"
});

async function verify() {
    try {
        await client.connect();
        console.log('Connected to DB');

        // We want to see if our normalization works. 
        // Since I can't easily call the Next.js action from a raw node script without setup,
        // I will simulate the normalization logic on the data fetched from DB.

        const res = await client.query("SELECT details, action FROM activity_logs WHERE action = 'lead_forwarded' LIMIT 5");
        console.log('Verifying normalization logic:');

        res.rows.forEach(row => {
            let details = row.details;
            console.log('Original Details Type:', typeof details);

            // Simulation of the fix in crm.ts
            if (details && typeof details === 'object') {
                if (row.action === 'lead_forwarded') {
                    const { lead_name, forwarded_to, note } = details;
                    details = `Forwarded "${lead_name || 'Lead'}" to ${forwarded_to || 'Unknown'}${note ? ` (Note: ${note})` : ''}`;
                } else {
                    details = JSON.stringify(details);
                }
            }

            console.log('Normalized Details:', details);
            console.log('---');
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

verify();
