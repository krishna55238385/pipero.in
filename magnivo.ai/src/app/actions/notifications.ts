'use server'

import pool from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { getSessionUser } from '@/lib/auth'

async function getDefaultOrgId(): Promise<string | null> {
  try {
    const r = await pool.query('SELECT id FROM public.organizations LIMIT 1')
    return r.rows[0]?.id ?? null
  } catch { return null }
}

export async function getMockableUser() {
  const session = await getSessionUser()
  if (!session) return null
  return { id: session.userId, email: session.email, role: session.role, organization_id: session.orgId, full_name: session.fullName }
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
