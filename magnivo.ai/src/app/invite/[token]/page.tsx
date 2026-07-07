'use client'

import { useEffect, useState, use } from 'react'
import { useRouter } from 'next/navigation'
import AuthShell from '@/components/auth/AuthShell'

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
  const router = useRouter()
  const [invite, setInvite] = useState<InviteInfo | null>(null)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/invite/${token}`)
      .then((res) => res.json())
      .then((data) => { if (!cancelled) setInvite(data) })
      .catch(() => { if (!cancelled) setInvite({ valid: false, error: 'Failed to load invite' }) })
    return () => { cancelled = true }
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/invite/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, full_name: fullName }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        return
      }
      router.push('/home')
      router.refresh()
    } catch {
      setError('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

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
      <div className="w-full rounded-3xl border border-slate-100 bg-white px-8 py-9 shadow-xl shadow-slate-300/40">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-slate-900">
            You&apos;ve been invited to join <span className="text-blue-600">{invite.orgName}</span>
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            You&apos;ll join as {roleLabel}. Create your account below to accept.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
            <input
              type="email"
              disabled
              value={invite.email || ''}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Jane Doe"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            {loading ? 'Creating account…' : 'Accept invite & create account'}
          </button>
        </form>
      </div>
    </AuthShell>
  )
}
