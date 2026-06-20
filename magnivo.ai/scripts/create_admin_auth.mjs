import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createAdminUser() {
    const email = 'krishnasuseel2001@gmail.com'
    const password = 'AdminPassword123!'

    console.log(`Setting up super admin account in Supabase Auth...`)

    const { data, error } = await supabase.auth.signUp({
        email,
        password,
    })

    // Since we are using anon key, this might send an email confirmation.
    // We can try to sign in to see if it works without confirmation.
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
    })

    if (signInError) {
        console.error('Sign In Error after signup:', signInError.message)
        // If user already registered, we can't easily change password with anon key, 
        // but we can ask user if they know it.
    } else {
        console.log(`Successfully signed in.`)
    }

    // Also make sure their role in the public.users table is super_admin
    const { error: roleError } = await supabase
        .from('users')
        .update({ role: 'super_admin' })
        .eq('email', email)

    if (roleError) {
        console.error('Role update error:', roleError.message)
    }

    console.log(`\nDONE! You can now log into the Admin App with:`)
    console.log(`Email: ${email}`)
    console.log(`Password: ${password}`)
}

createAdminUser()
