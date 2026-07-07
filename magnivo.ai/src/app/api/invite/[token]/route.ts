import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { signSessionToken, SESSION_COOKIE } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) return NextResponse.json({ valid: false, error: 'Missing token' }, { status: 400 })

  try {
    const result = await pool.query(
      `SELECT oi.email, oi.role, oi.status, oi.expires_at, o.id AS org_id, o.name AS org_name
       FROM public.organization_invites oi
       JOIN public.organizations o ON o.id = oi.organization_id
       WHERE oi.token = $1
       LIMIT 1`,
      [token]
    )

    const invite = result.rows[0]
    if (!invite) return NextResponse.json({ valid: false, error: 'Invite not found' }, { status: 404 })
    if (invite.status !== 'pending') {
      return NextResponse.json(
        { valid: false, status: invite.status, email: invite.email, error: 'This invite has already been used or revoked' },
        { status: 410 }
      )
    }
    if (new Date(invite.expires_at) < new Date()) return NextResponse.json({ valid: false, error: 'This invite has expired' }, { status: 410 })

    return NextResponse.json({
      valid: true,
      email: invite.email,
      role: invite.role,
      orgId: invite.org_id,
      orgName: invite.org_name,
    })
  } catch (err: any) {
    return NextResponse.json({ valid: false, error: err.message || 'Failed to look up invite' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { password, full_name } = await req.json()
  if (!password || !full_name) {
    return NextResponse.json({ error: 'Full name and password are required' }, { status: 400 })
  }

  const inviteResult = await pool.query(
    `SELECT id, email, role, organization_id, status, expires_at FROM public.organization_invites WHERE token = $1 LIMIT 1`,
    [token]
  )
  const invite = inviteResult.rows[0]
  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  if (invite.status !== 'pending') return NextResponse.json({ error: 'This invite has already been used or revoked' }, { status: 410 })
  if (new Date(invite.expires_at) < new Date()) return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })

  const existing = await pool.query('SELECT id FROM public.users WHERE email = $1 LIMIT 1', [invite.email])
  if (existing.rows[0]) return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })

  const passwordHash = await bcrypt.hash(password, 10)

  const inserted = await pool.query(
    `INSERT INTO public.users (organization_id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email, role, organization_id, full_name`,
    [invite.organization_id, invite.email, passwordHash, full_name, invite.role]
  )
  const user = inserted.rows[0]

  await pool.query(`UPDATE public.organization_invites SET status = 'accepted', accepted_at = now() WHERE id = $1`, [invite.id])

  const jwtToken = signSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    orgId: user.organization_id,
    fullName: user.full_name,
  })

  const res = NextResponse.json({ success: true })
  res.cookies.set(SESSION_COOKIE, jwtToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
