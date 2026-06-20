const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Using the pooler URL from .env.local
const connectionString = "postgresql://postgres.xhjxpesdvcrensccdydh:SSKappu@123@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres";

const client = new Client({
    connectionString: connectionString
});

async function runMigration() {
    await client.connect();
    try {
        console.log('Connected to Supabase Pooler...');
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20240417000000_automation_flows.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Running migration: 20240417000000_automation_flows.sql');
        await client.query(sql);
        console.log('Migration successful!');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await client.end();
    }
}

runMigration();
