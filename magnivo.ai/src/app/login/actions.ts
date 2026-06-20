'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function login(formData: FormData) {
    const data = {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
    }

    // Mock Login to bypass Supabase Email Rate Limits for Local Dev
    if (data.email) {
        const { cookies } = await import('next/headers')
        const cookieStore = await cookies()
        cookieStore.set('sb-mock-auth', 'true', {
            path: '/',
            maxAge: 60 * 60 * 24 * 7,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
        })
        revalidatePath('/', 'layout')
        redirect('/home')
    } else {
       redirect('/login?error=Please enter an email')
    }
}

export async function signup(formData: FormData) {
    const supabase = await createClient()

    const data = {
        email: formData.get('email') as string,
        password: formData.get('password') as string,
    }

    const { error } = await supabase.auth.signUp(data)

    if (error) {
        console.error('Supabase Signup Error:', error.message)
        redirect('/login?error=Could not authenticate user')
    }

    revalidatePath('/home', 'layout')
    redirect('/home')
}
