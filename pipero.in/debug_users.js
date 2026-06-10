import { Client } from 'pg';

const dbUrl = 'postgresql://postgres.xhjxpesdvcrensccdydh:SSKappu@123@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function checkDb() {
    const client = new Client({ connectionString: dbUrl });
    try {
        await client.connect();

        // Check organizations
        const orgs = await client.query('SELECT id, name FROM organizations');
        console.log('Organizations:', orgs.rows);

        // Check users
        const users = await client.query(`
      SELECT u.id, u.full_name, u.role, u.organization_id, au.email 
      FROM public.users u
      JOIN auth.users au ON u.id = au.id
      WHERE au.email = 'krishnasuseel2001@gmail.com'
    `);
        console.log('User Record:', users.rows[0]);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

checkDb();
