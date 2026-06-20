import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function runMigration() {
    console.log('Running admin migration...')

    // 1. Check if plan column already exists
    const { data: existing } = await supabase
        .from('organizations')
        .select('plan')
        .limit(1)

    if (!existing) {
        console.log('Note: plan column may not exist yet - will use ALTER TABLE')
    }

    // 2. Try to add the columns using raw SQL via rpc
    const migrationSQL = `
    ALTER TABLE organizations
      ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 5,
      ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS notes TEXT;
  `

    const { error: migError } = await supabase.rpc('exec_sql', { sql: migrationSQL })

    if (migError) {
        // RPC might not exist; try direct update approach (columns might already exist from template)
        console.warn('RPC exec_sql failed (expected if not set up). Checking if columns exist by trying an update...')

        // Test if columns exist by doing a safe select
        const { error: planError } = await supabase
            .from('organizations')
            .select('plan, max_users, is_suspended, plan_expires_at, feature_flags, notes')
            .limit(1)

        if (planError) {
            console.error('Columns do not exist and cannot run migration via RPC.')
            console.log('\n=== MANUAL MIGRATION REQUIRED ===')
            console.log('Please run this SQL in your Supabase SQL Editor:')
            console.log('https://supabase.com/dashboard/project/xhjxpesdvcrensccdydh/sql/new\n')
            console.log(`ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS max_users INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS notes TEXT;`)
            console.log('\nAlso run this to mark yourself as super_admin:')
            console.log(`UPDATE users SET role = 'super_admin' WHERE email = 'krishnasuseel2001@gmail.com';`)
            return
        }

        console.log('✅ Columns already exist! Migration not needed.')
    } else {
        console.log('✅ Migration applied successfully via RPC.')
    }

    // 3. Check current org state
    const { data: orgs } = await supabase
        .from('organizations')
        .select('id, name, plan, max_users, is_suspended')

    console.log('\n📋 Current Organizations:')
    orgs?.forEach(org => {
        console.log(`  - ${org.name} | plan: ${org.plan} | max_users: ${org.max_users} | suspended: ${org.is_suspended}`)
    })
}

runMigration()
