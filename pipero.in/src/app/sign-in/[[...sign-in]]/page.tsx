import { SignIn } from '@clerk/nextjs'
import AuthShell, { clerkAppearance } from '@/components/auth/AuthShell'

export default function SignInPage() {
  return (
    <AuthShell>
      <SignIn appearance={clerkAppearance} />
    </AuthShell>
  )
}
