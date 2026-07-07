import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { signSessionToken, SESSION_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  const result = await pool.query(
    'SELECT id, email, password_hash, role, organization_id, full_name FROM public.users WHERE email = $1 LIMIT 1',
    [String(email).toLowerCase().trim()]
  )
  const user = result.rows[0]
  if (!user || !user.password_hash) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const token = signSessionToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    orgId: user.organization_id,
    fullName: user.full_name,
  })

  const res = NextResponse.json({ success: true, user: { email: user.email, role: user.role } })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}
