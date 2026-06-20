const { Client } = require('pg');
const client = new Client({
    connectionString: 'postgresql://postgres:SSKappu@123@db.xhjxpesdvcrensccdydh.supabase.co:5432/postgres'
});

async function migrate() {
    await client.connect();
    try {
        console.log('Adding columns to leads table...');
        await client.query(`
            ALTER TABLE leads 
            ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT 100,
            ADD COLUMN IF NOT EXISTS enrichment_data JSONB DEFAULT '{}';
        `);
        console.log('Successfully updated leads table schema.');

        console.log('Adding columns to lead_routing_settings...');
        await client.query(`
            ALTER TABLE lead_routing_settings
            ADD COLUMN IF NOT EXISTS load_balancing_enabled BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS max_leads_per_user INTEGER DEFAULT 20;
        `);

        console.log('Creating lead_routing_rules table if not exists...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS lead_routing_rules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID REFERENCES organizations(id),
                name TEXT NOT NULL,
                priority INTEGER DEFAULT 0,
                conditions JSONB DEFAULT '[]',
                assign_to_user_id UUID REFERENCES users(id),
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMPTZ DEFAULT now(),
                updated_at TIMESTAMPTZ DEFAULT now()
            );
        `);
        console.log('Successfully updated routing schema.');

    } catch (e) { console.error('Migration failed:', e) }
    await client.end();
}
migrate();
