import { NextRequest, NextResponse } from 'next/server'
import pool from '@/lib/db'

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
