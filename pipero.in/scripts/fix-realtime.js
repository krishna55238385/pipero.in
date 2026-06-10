const fs = require('fs');
const dotenv = require('dotenv');
const { Client } = require('pg');

// Manually load .env.local
const envContent = fs.readFileSync('.env.local', 'utf8');
const envConfig = dotenv.parse(envContent);
for (const k in envConfig) { process.env[k] = envConfig[k]; }

async function run() {
    const client = new Client({ connectionString: process.env.DIRECT_URL });
    try {
        await client.connect();
        const sql = fs.readFileSync('supabase/migrations/20240430000000_fix_realtime.sql', 'utf8');
        await client.query(sql);
        console.log("Realtime enabled for messages and conversations.");
    } catch (err) {
        if (err.message.includes('already exists')) {
            console.log("Realtime was likely already enabled (or partially enabled).");
        } else {
            console.error("Failed to enable realtime:", err);
        }
    } finally {
        await client.end();
    }
}
run();
