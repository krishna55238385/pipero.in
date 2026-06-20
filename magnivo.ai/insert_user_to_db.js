import { Client } from 'pg';

const dbUrl = 'postgresql://postgres.xhjxpesdvcrensccdydh:SSKappu@123@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres';

async function fixUser() {
    const client = new Client({ connectionString: dbUrl });
    try {
        await client.connect();

        // 1. Get auth user ID
        const authUser = await client.query(`SELECT id FROM auth.users WHERE email = 'krishnasuseel2001@gmail.com'`);
        if (authUser.rows.length === 0) {
            console.log('Auth user not found!');
            return;
        }
        const userId = authUser.rows[0].id;
        console.log('Found user in auth.users:', userId);

        // 2. Get organization ID
        const orgs = await client.query('SELECT id FROM organizations LIMIT 1');
        if (orgs.rows.length === 0) {
            console.log('No organization found!');
            return;
        }
        const orgId = orgs.rows[0].id;
        console.log('Using organization:', orgId);

        // 3. Insert or update in public.users
        await client.query(`
      INSERT INTO public.users (id, organization_id, full_name, role)
      VALUES ($1, $2, 'Krishna Suseel', 'admin')
      ON CONFLICT (id) DO UPDATE SET role = 'admin', organization_id = $2;
    `, [userId, orgId]);

        console.log('Successfully inserted/updated user in public.users!');

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await client.end();
    }
}

fixUser();
