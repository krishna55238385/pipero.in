import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function createUser(email, password, full_name, role) {
    console.log(`Setting up ${role} account in Supabase Auth...`)

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                full_name,
                role
            }
        }
    })

    if (signUpError) {
        console.error('Sign Up Error:', signUpError.message)
    }

    // Try to sign in
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
    })

    if (signInError) {
        console.error('Sign In Error after signup:', signInError.message)
    } else {
        console.log(`Successfully signed in as ${role}.`)
    }

    const userId = signInData?.user?.id || signUpData?.user?.id;

    if (userId) {
        // Also make sure their role in the public.users table is set
        const { error: roleError } = await supabase
            .from('users')
            .update({ role, full_name })
            .eq('id', userId)

        if (roleError) {
            console.error('Role update error:', roleError.message)
        }
    } else {
        console.error('Could not get user ID to update role.')
    }

    console.log(`\nDONE! You can now log in with:`)
    console.log(`Email: ${email}`)
    console.log(`Password: ${password}`)
}

async function run() {
    await createUser('arkaprabha.saha@intellinez.com', 'Meratutor@123', 'arkha prabha', 'rep');
    await createUser('Sujith@intellinez.com', 'Meratutor@123', 'Sujith', 'super_admin');
    await createUser('bhishm@avaniglobal.in', 'Crm@123', 'Bhishm', 'admin');
    await createUser('krishnasuseel2001@gmail.com', 'SSKappu@123', 'Krishna Suseel', 'super_admin');
}

run()
