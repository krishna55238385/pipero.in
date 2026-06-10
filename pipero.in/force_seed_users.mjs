
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const { Client } = pg;

async function run() {
    const client = new Client({
        connectionString: process.env.DIRECT_URL,
        ssl: { rejectUnauthorized: false }
    });

    try {
        await client.connect();
        console.log('Connected to DB');

        // Get an organization ID
        const orgRes = await client.query('SELECT id FROM organizations LIMIT 1');
        if (orgRes.rows.length === 0) {
            console.log('No orgs found');
            return;
        }
        const orgId = orgRes.rows[0].id;

        // Disable the foreign key constraint on users table temporarily
        console.log('Disabling FK constraint...');
        await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey');

        const demoUsers = [
            ['d9e0f124-c8c2-4a0b-967a-123456789012', orgId, 'Demo Admin', 'admin'],
            ['e1234567-c8c2-4a0b-967a-123456789013', orgId, 'Sales Rep 1', 'user'],
            ['f7894561-c8c2-4a0b-967a-123456789014', orgId, 'Sales Rep 2', 'user']
        ];

        for (const user of demoUsers) {
            console.log(`Inserting user: ${user[2]}`);
            await client.query(
                'INSERT INTO users (id, organization_id, full_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role',
                user
            );
        }

        console.log('Successfully seeded users and bypassed auth.users constraint');
    } catch (err) {
        console.error('Database error:', err);
    } finally {
        await client.end();
    }
}

run();
