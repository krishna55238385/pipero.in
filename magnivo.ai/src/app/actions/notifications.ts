'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { currentUser } from '@clerk/nextjs/server'

async function getDefaultOrgId(): Promise<string | null> {
  try {
    const r = await pool.query('SELECT id FROM public.organizations LIMIT 1')
    return r.rows[0]?.id ?? null
  } catch { return null }
}

async function getOrCreateUser(clerkUser: { id: string, email: string | null, firstName?: string | null, lastName?: string | null }) {
  // Try to find existing user
  const existing = await pool.query(
    'SELECT * FROM public.users WHERE clerk_id = $1 LIMIT 1',
    [clerkUser.id]
  )

  if (existing.rows[0]) {
    // Update email if missing
    if (!existing.rows[0].email && clerkUser.email) {
      await pool.query(
        'UPDATE public.users SET email = $1 WHERE clerk_id = $2',
        [clerkUser.email, clerkUser.id]
      )
    }
    return existing.rows[0]
  }

  // Not found by clerk_id — check if a user with this email already exists
  if (clerkUser.email) {
    const byEmail = await pool.query(
      'SELECT * FROM public.users WHERE email = $1 LIMIT 1',
      [clerkUser.email]
    )
    if (byEmail.rows[0]) return byEmail.rows[0]
  }

  // Still not found — check for a pending invite matching this email
  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || clerkUser.email || 'New User'

  if (clerkUser.email) {
    const invite = await pool.query(
      `SELECT id, organization_id, role FROM public.organization_invites
       WHERE email = $1 AND status = 'pending' AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [clerkUser.email]
    )
    const invited = invite.rows[0]
    if (invited) {
      const invitedUser = await pool.query(
        `INSERT INTO public.users (clerk_id, organization_id, email, full_name, role)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [clerkUser.id, invited.organization_id, clerkUser.email, fullName, invited.role]
      )
      await pool.query(
        `UPDATE public.organization_invites SET status = 'accepted', accepted_at = now() WHERE id = $1`,
        [invited.id]
      )
      return invitedUser.rows[0]
    }
  }

  // No invite either — fall back to the existing org
  const orgResult = await pool.query('SELECT id FROM public.organizations LIMIT 1')
  const orgId = orgResult.rows[0]?.id
  if (!orgId) return null

  const newUser = await pool.query(
    `INSERT INTO public.users (clerk_id, organization_id, email, full_name, role)
     VALUES ($1, $2, $3, $4, 'admin')
     RETURNING *`,
    [clerkUser.id, orgId, clerkUser.email, fullName]
  )

  return newUser.rows[0]
}

export async function getMockableUser() {
  try {
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'
    const clerkUser = await currentUser()

    if (!clerkUser && isMockAuth) {
      const r = await pool.query('SELECT * FROM public.users LIMIT 1')
      return r.rows[0] ?? null
    }

    if (clerkUser) {
      const user = await getOrCreateUser({
        id: clerkUser.id,
        email: clerkUser.emailAddresses?.[0]?.emailAddress ?? null,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
      })
      return user ?? null
    }

    return null
  } catch { return null }
}

export async function getNotifications() {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return []

    const user = await getMockableUser()
    if (!user) return []

    const result = await pool.query(`
      SELECT n.*,
        json_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) AS actor
      FROM public.notifications n
      LEFT JOIN public.users u ON u.id = n.actor_id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [user.id])
    return result.rows
  } catch (err: any) {
    console.error('Error fetching notifications:', err.message)
    return []
  }
}

export async function createNotification(payload: {
  user_id: string
  actor_id?: string
  type: string
  title: string
  content?: string
  link_url?: string
}) {
  try {
    const orgId = await getDefaultOrgId()
    if (!orgId) return { error: 'No org found' }

    await pool.query(
      'INSERT INTO public.notifications (organization_id, user_id, actor_id, type, title, content, link_url) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orgId, payload.user_id, payload.actor_id ?? null, payload.type, payload.title, payload.content ?? null, payload.link_url ?? null]
    )

    revalidatePath('/', 'layout')
    return { success: true }
  } catch (err: any) {
    console.error('Error creating notification:', err.message)
    return { error: err.message }
  }
}

export async function markAsRead(notificationIds: string[]) {
  try {
    if (!notificationIds.length) return { success: true }
    const ph = notificationIds.map((_, i) => `$${i + 2}`).join(', ')
    await pool.query(
      `UPDATE public.notifications SET read_at = $1 WHERE id IN (${ph}) AND read_at IS NULL`,
      [new Date().toISOString(), ...notificationIds]
    )
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (err: any) {
    console.error('Error marking notifications read:', err.message)
    return { error: err.message }
  }
}

export async function markAllAsRead() {
  try {
    const user = await getMockableUser()
    if (!user) return { error: 'Not authenticated' }

    await pool.query(
      'UPDATE public.notifications SET read_at = $1 WHERE user_id = $2 AND read_at IS NULL',
      [new Date().toISOString(), user.id]
    )
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (err: any) {
    console.error('Error marking all read:', err.message)
    return { error: err.message }
  }
}

export async function deleteNotification(notificationId: string) {
  try {
    await pool.query('DELETE FROM public.notifications WHERE id = $1', [notificationId])
    revalidatePath('/', 'layout')
    return { success: true }
  } catch (err: any) {
    console.error('Error deleting notification:', err.message)
    return { error: err.message }
  }
}
