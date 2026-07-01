const fs = require('fs');
const dotenv = require('dotenv');
const envConfig = dotenv.parse(fs.readFileSync('.env.local'));
for (const k in envConfig) { process.env[k] = envConfig[k]; }
// Mirrors the pool config in src/lib/db.ts — scripts run outside Next.js's
// module resolution, so the '@/lib/db' path alias isn't usable here directly.
const { Pool } = require('pg');

async function run() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    try {
        const orgRes = await pool.query('SELECT id FROM public.organizations LIMIT 1');
        if (orgRes.rows.length === 0) {
            console.log('No organization found, nothing to seed');
            return;
        }
        const orgId = orgRes.rows[0].id;

        await pool.query("INSERT INTO public.lead_statuses (organization_id, label, color, sort_order) VALUES ($1, 'New', '#3b82f6', 0) ON CONFLICT DO NOTHING", [orgId]);
        await pool.query("INSERT INTO public.lead_statuses (organization_id, label, color, sort_order) VALUES ($1, 'Qualified', '#10b981', 1) ON CONFLICT DO NOTHING", [orgId]);
        await pool.query("INSERT INTO public.pipeline_stages (organization_id, label, probability, sort_order) VALUES ($1, 'Discovery', 20, 0) ON CONFLICT DO NOTHING", [orgId]);
        await pool.query("INSERT INTO public.pipeline_stages (organization_id, label, probability, sort_order) VALUES ($1, 'Proposal', 70, 1) ON CONFLICT DO NOTHING", [orgId]);
        await pool.query("INSERT INTO public.lead_routing_settings (organization_id, assignment_mode) VALUES ($1, 'manual') ON CONFLICT DO NOTHING", [orgId]);
        await pool.query("INSERT INTO public.lead_hygiene_settings (organization_id) VALUES ($1) ON CONFLICT DO NOTHING", [orgId]);

        console.log('Seeded defaults');
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
run();
