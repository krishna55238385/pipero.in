import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

// Auth is handled by Clerk. This legacy route keeps the local-dev bypass and
// otherwise forwards to the Clerk sign-in page.
export default async function LoginPage() {
    if (process.env.NEXT_PUBLIC_BYPASS_AUTH === 'true') redirect('/home')
    const cookieStore = await cookies()
    if (cookieStore.get('sb-mock-auth')?.value === 'true') redirect('/home')
    redirect('/sign-in')
}
