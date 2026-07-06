'use client'

import { useEffect, useState, use } from 'react'
import { SignUp } from '@clerk/nextjs'
import AuthShell, { clerkAppearance } from '@/components/auth/AuthShell'

type InviteInfo = {
  valid: boolean
  status?: string
  email?: string
  role?: string
  orgId?: string
  orgName?: string
  error?: string
}

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [invite, setInvite] = useState<InviteInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/invite/${token}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setInvite(data) })
      .catch(() => { if (!cancelled) setInvite({ valid: false, error: 'Failed to load invite' }) })
    return () => { cancelled = true }
  }, [token])

  if (!invite) {
    return (
      <AuthShell>
        <div className="text-center text-slate-500">Loading invite…</div>
      </AuthShell>
    )
  }

  if (!invite.valid) {
    return (
      <AuthShell>
        <div className="w-full rounded-3xl border border-slate-100 bg-white px-8 py-9 text-center shadow-xl shadow-slate-300/40">
          <h1 className="text-xl font-semibold text-slate-900">Invite unavailable</h1>
          <p className="mt-2 text-slate-500">{invite.error || 'This invite link is no longer valid.'}</p>
        </div>
      </AuthShell>
    )
  }

  const roleLabel = invite.role === 'admin' ? 'an Admin' : 'a Member'

  return (
    <AuthShell>
      <div className="w-full">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            You&apos;ve been invited to join <span className="text-blue-600">{invite.orgName}</span>
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            You&apos;ll join as {roleLabel}. Create your account below to accept.
          </p>
        </div>
        <SignUp
          appearance={clerkAppearance}
          initialValues={{ emailAddress: invite.email }}
          signInUrl="/sign-in"
          forceRedirectUrl="/home"
          fallbackRedirectUrl="/home"
        />
      </div>
    </AuthShell>
  )
}
