import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'

export async function POST(req: NextRequest) {
  const { email, password, full_name } = await req.json()
  if (!email || !password || !full_name) {
    return NextResponse.json({ error: 'Full name, email and password are required' }, { status: 400 })
  }

  const normalizedEmail = String(email).toLowerCase().trim()

  const existing = await pool.query('SELECT id FROM public.users WHERE email = $1 LIMIT 1', [normalizedEmail])
  if (existing.rows[0]) {
    return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
  }

  const inviteResult = await pool.query(
    `SELECT id, organization_id, role FROM public.organization_invites
     WHERE email = $1 AND status = 'pending' AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [normalizedEmail]
  )
  const invite = inviteResult.rows[0]

  let orgId: string
  let role: string

  if (invite) {
    orgId = invite.organization_id
    role = invite.role
  } else {
    const domain = normalizedEmail.split('@')[1]?.split('.')[0] ?? 'New'
    const orgName = domain.charAt(0).toUpperCase() + domain.slice(1)
    const orgResult = await pool.query(
      'INSERT INTO public.organizations (name) VALUES ($1) RETURNING id',
      [orgName]
    )
    orgId = orgResult.rows[0]?.id
    role = 'admin'
    if (!orgId) {
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
    }
  }

  const passwordHash = await bcrypt.hash(password, 10)

  await pool.query(
    `INSERT INTO public.users (organization_id, email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, normalizedEmail, passwordHash, full_name, role]
  )

  if (invite) {
    await pool.query(
      `UPDATE public.organization_invites SET status = 'accepted', accepted_at = now() WHERE id = $1`,
      [invite.id]
    )
  } else {
    try {
      await pool.query(
        'INSERT INTO public.onboarding_tracker (organization_id) VALUES ($1)',
        [orgId]
      )
      await pool.query(
        `INSERT INTO public.client_subscriptions (organization_id, plan_name, status, mrr_cents, payment_status)
         VALUES ($1, 'starter', 'trial', 0, 'trial')`,
        [orgId]
      )
    } catch (err) {
      console.error('Failed to create onboarding tracker / default subscription for org', orgId, err)
    }
  }

  return NextResponse.json({ success: true })
}
