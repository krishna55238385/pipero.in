import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

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

export async function requireAuth(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  return user
}

export async function requireAdmin(): Promise<{ isAdmin: boolean; user: SessionUser | null; error?: string }> {
  const user = await getSessionUser()
  if (!user) return { isAdmin: false, user: null, error: 'Authentication required' }
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  if (!isAdmin) return { isAdmin: false, user, error: 'Admin privileges required' }
  return { isAdmin: true, user }
}
