const { Client } = require('pg');
const client = new Client({
    connectionString: 'postgresql://postgres:SSKappu@123@db.xhjxpesdvcrensccdydh.supabase.co:5432/postgres'
});

async function migrate() {
    await client.connect();
    try {
        console.log('Adding specific routing fields to leads table...');
        await client.query(`
            ALTER TABLE leads 
            ADD COLUMN IF NOT EXISTS industry TEXT,
            ADD COLUMN IF NOT EXISTS company_size TEXT,
            ADD COLUMN IF NOT EXISTS annual_revenue NUMERIC,
            ADD COLUMN IF NOT EXISTS zip_code TEXT,
            ADD COLUMN IF NOT EXISTS language TEXT;
        `);

        console.log('Adding performance and capability fields to users table...');
        await client.query(`
            ALTER TABLE users
            ADD COLUMN IF NOT EXISTS lead_weight INTEGER DEFAULT 100,
            ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]',
            ADD COLUMN IF NOT EXISTS availability_status BOOLEAN DEFAULT true;
        `);

        console.log('Updating lead_routing_rules to support more complex logic...');
        // ensure rule_routing_rules has updated_at and created_at if not present
        await client.query(`
            ALTER TABLE lead_routing_rules
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
        `);

        console.log('Successfully expanded schema for advanced allocation.');
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await client.end();
    }
}
migrate();
