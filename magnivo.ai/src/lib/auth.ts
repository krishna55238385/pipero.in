import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import pool from '@/lib/db'

const JWT_SECRET = process.env.JWT_SECRET as string
export const SESSION_COOKIE = 'magnivo_token'

export interface SessionUser {
  userId: string
  email: string
  role: string
  orgId: string | null
  fullName: string | null
}

interface SessionTokenPayload {
  userId: string
  email: string
  role: string
  orgId: string | null
  fullName: string | null
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token) return null
    const payload = jwt.verify(token, JWT_SECRET) as SessionTokenPayload
    return {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      orgId: payload.orgId ?? null,
      fullName: payload.fullName ?? null,
    }
  } catch {
    return null
  }
}

// Re-checked against the DB on every call so a user deactivated mid-session
// (toggleUserSuspension/removeUser), or whose organization is archived
// (Super Admin "Delete Organization"), is rejected on their next request,
// not only after their JWT naturally expires. Fails closed on a DB error.
async function isSessionUserActive(userId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT u.is_active, u.organization_id, o.deleted_at AS org_deleted_at
       FROM public.users u
       LEFT JOIN public.organizations o ON o.id = u.organization_id
       WHERE u.id = $1 LIMIT 1`,
      [userId]
    )
    const row = result.rows[0]
    if (!row || row.is_active !== true) return false
    if (row.organization_id && row.org_deleted_at) return false
    return true
  } catch {
    return false
  }
}

export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!(await isSessionUserActive(user.userId))) redirect('/login')
  return user
}

export async function requireAdmin(): Promise<{ isAdmin: boolean; user: SessionUser | null; error?: string }> {
  const user = await getSessionUser()
  if (!user) return { isAdmin: false, user: null, error: 'Authentication required' }
  if (!(await isSessionUserActive(user.userId))) {
    try {
      const cookieStore = await cookies()
      cookieStore.delete(SESSION_COOKIE)
    } catch {
      // requireAdmin is only invoked from Server Actions, where cookie
      // mutation is legal; this catch just guards against future misuse.
    }
    return { isAdmin: false, user: null, error: 'Authentication required' }
  }
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  if (!isAdmin) return { isAdmin: false, user, error: 'Admin privileges required' }
  return { isAdmin: true, user }
}
