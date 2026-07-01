'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

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

export async function signup(_formData: FormData) {
    // Signup is handled via Clerk or admin invite — not via Supabase auth
    redirect('/login?error=Signup not available — contact your admin')
}
