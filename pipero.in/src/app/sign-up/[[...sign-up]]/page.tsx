import { SignUp } from '@clerk/nextjs'
import AuthShell, { clerkAppearance } from '@/components/auth/AuthShell'

export default function SignUpPage() {
  return (
    <AuthShell>
      <SignUp appearance={clerkAppearance} />
    </AuthShell>
  )
}
