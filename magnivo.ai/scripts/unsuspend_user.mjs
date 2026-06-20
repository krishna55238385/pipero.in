import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const { Client } = pg

async function runWithDirectUrl(email, directUrl) {
  const client = new Client({
    connectionString: directUrl,
    ssl: { rejectUnauthorized: false },
  })

  try {
    await client.connect()
    console.log('Connected to database')

    const { rows: authRows } = await client.query(
      'SELECT id FROM auth.users WHERE email = $1 LIMIT 1',
      [email]
    )

    if (authRows.length === 0) {
      console.error('No auth.user found with email:', email)
      return
    }

    const userId = authRows[0].id
    console.log('Found user id:', userId)

    const result = await client.query(
      'UPDATE public.users SET is_active = true WHERE id = $1 RETURNING id, full_name, role, is_active',
      [userId]
    )

    if (result.rowCount === 0) {
      console.error('No public.users row found for that id')
      return
    }

    console.log('User unsuspended:', result.rows[0])
  } finally {
    await client.end()
  }
}

async function runWithSupabase(email, url, serviceRoleKey) {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  const authUser = list?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase())
  if (!authUser) {
    console.error('No auth.user found with email:', email)
    return
  }

  const { data, error } = await supabase
    .from('users')
    .update({ is_active: true })
    .eq('id', authUser.id)
    .select('id, full_name, role, is_active')
    .single()

  if (error) {
    console.error('Update failed:', error.message)
    return
  }
  console.log('User unsuspended:', data)
}

async function run(email) {
  if (!email) {
    console.error('Usage: node scripts/unsuspend_user.mjs <email>')
    console.error('')
    console.error('For production (e.g. Vercel), use the same Supabase project as the app and run:')
    console.error('  NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=eyJ... node scripts/unsuspend_user.mjs <email>')
    console.error('Or set DIRECT_URL in .env.local and run: node scripts/unsuspend_user.mjs <email>')
    process.exit(1)
  }

  const directUrl = process.env.DIRECT_URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (directUrl) {
    await runWithDirectUrl(email, directUrl)
  } else if (supabaseUrl && serviceRoleKey) {
    await runWithSupabase(email, supabaseUrl, serviceRoleKey)
  } else {
    console.error('Set either DIRECT_URL or (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) in .env.local or env')
    process.exit(1)
  }
}

// If run directly: node scripts/unsuspend_user.mjs email@example.com
const emailArg = process.argv[2]
run(emailArg).catch(err => {
  console.error('Error:', err)
  process.exit(1)
})

