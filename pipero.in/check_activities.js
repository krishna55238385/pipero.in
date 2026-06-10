const { Client } = require('pg');

const client = new Client({
    connectionString: "postgresql://postgres.xhjxpesdvcrensccdydh:SSKappu%40123@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres"
});

async function check() {
    try {
        await client.connect();
        console.log('Connected to DB');

        const res = await client.query("SELECT details, action FROM activity_logs ORDER BY created_at DESC LIMIT 50");
        console.log('Recent activities:');
        res.rows.forEach(row => {
            console.log(`Action: ${row.action}, Details Type: ${typeof row.details}`);
            if (typeof row.details === 'object') {
                console.log('Object details:', JSON.stringify(row.details));
            } else {
                console.log('Details:', row.details);
            }
            console.log('---');
        });

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

check();
