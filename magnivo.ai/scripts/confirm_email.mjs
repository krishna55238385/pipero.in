import pkg from 'pg';
const { Client } = pkg;
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function run() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();

        // Update intellinez users
        const res = await client.query(`
            UPDATE public.users pu
            SET organization_id = (SELECT id FROM public.organizations ORDER BY created_at ASC LIMIT 1)
            FROM auth.users au
            WHERE pu.id = au.id AND au.email ILIKE '%intellinez.com%'
            RETURNING pu.id, pu.full_name, pu.role, pu.organization_id;
        `);

        if (res.rowCount > 0) {
            console.log('Successfully updated organization_id for:', res.rows);
        } else {
            console.log('No intellinez users found in public.users');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.end();
    }
}

run();
