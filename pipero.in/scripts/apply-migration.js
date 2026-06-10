const fs = require('fs');
const dotenv = require('dotenv');
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
for (const k in envConfig) { process.env[k] = envConfig[k]; }
const { Client } = require('pg');

async function run() {
    const client = new Client({ connectionString: process.env.DIRECT_URL });
    try {
        await client.connect();
        const sql = fs.readFileSync('supabase/migrations/20240410000000_lead_management_settings.sql', 'utf8');
        await client.query(sql);
        console.log("Migration applied: Add lead management schema");
    } catch (err) {
        console.error("Migration failed:", err);
    } finally {
        await client.end();
    }
}
run();
