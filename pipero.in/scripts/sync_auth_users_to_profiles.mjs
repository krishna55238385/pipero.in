import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const { Client } = pg

async function run() {
  const directUrl = process.env.DIRECT_URL

  if (!directUrl) {
    console.error('DIRECT_URL is not set in .env.local')
    process.exit(1)
  }

  const client = new Client({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    console.log('Connected to database')

    // Ensure we have at least one organization to attach users to
    const orgRes = await client.query('SELECT id FROM organizations LIMIT 1')
    if (orgRes.rows.length === 0) {
      console.error('No organizations found in database')
      return
    }
    const orgId = orgRes.rows[0].id
    console.log('Using organization id:', orgId)

    // Insert missing profile rows for any auth.users that don't yet exist in public.users
    const insertSql = `
      INSERT INTO users (id, organization_id, full_name, role)
      SELECT
        au.id,
        $1::uuid AS organization_id,
        COALESCE(au.raw_user_meta_data->>'full_name', split_part(au.email, '@', 1)) AS full_name,
        COALESCE(au.raw_user_meta_data->>'role', 'user') AS role
      FROM auth.users au
      WHERE NOT EXISTS (
        SELECT 1 FROM users u WHERE u.id = au.id
      );
    `

    const result = await client.query(insertSql, [orgId])
    console.log(`Synced ${result.rowCount} auth users into public.users`)
  } catch (err) {
    console.error('Error syncing users:', err)
  } finally {
    await client.end()
  }
}

run()

