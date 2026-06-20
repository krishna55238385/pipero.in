const fs = require('fs');
const dotenv = require('dotenv');
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
for (const k in envConfig) { process.env[k] = envConfig[k]; }
const { Client } = require('pg');

async function run() {
    const client = new Client({ connectionString: process.env.DIRECT_URL });
    try {
        await client.connect();
        const orgRes = await client.query('SELECT id FROM organizations LIMIT 1');
        if (orgRes.rows.length === 0) return;
        const orgId = orgRes.rows[0].id;

        await client.query("INSERT INTO lead_statuses (organization_id, label, color, sort_order) VALUES ($1, 'New', '#3b82f6', 0) ON CONFLICT DO NOTHING", [orgId]);
        await client.query("INSERT INTO lead_statuses (organization_id, label, color, sort_order) VALUES ($1, 'Qualified', '#10b981', 1) ON CONFLICT DO NOTHING", [orgId]);
        await client.query("INSERT INTO pipeline_stages (organization_id, label, probability, sort_order) VALUES ($1, 'Discovery', 20, 0) ON CONFLICT DO NOTHING", [orgId]);
        await client.query("INSERT INTO pipeline_stages (organization_id, label, probability, sort_order) VALUES ($1, 'Proposal', 70, 1) ON CONFLICT DO NOTHING", [orgId]);
        await client.query("INSERT INTO lead_routing_settings (organization_id, assignment_mode) VALUES ($1, 'manual') ON CONFLICT DO NOTHING", [orgId]);
        await client.query("INSERT INTO lead_hygiene_settings (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [orgId]);

        console.log('Seeded defaults');
    } catch (err) {
        console.error(err);
    } finally {
        await client.end();
    }
}
run();
