'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'

// Define a common utility for getting the current org inside this file
async function getDefaultOrgId(supabase: any) {
  const { data } = await supabase.from('organizations').select('id').limit(1).single()
  return data?.id
}


export async function getMockableUser() {
    const supabase = await createClient()
    let { data: { user } } = await supabase.auth.getUser()
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'

    if (!user && isMockAuth) {
        const { data: firstUser } = await supabase.from('users').select('*').limit(1).single()
        if (firstUser) user = { ...firstUser } as any
    }

    if (user) {
        const { data: profile } = await supabase.from('users').select('*').eq('id', user.id).single()
        if (profile) return { ...user, ...profile }
    }
    return user
}

export async function getNotifications() {
  const supabase = await createClient()
  const orgId = await getDefaultOrgId(supabase)
  if (!orgId) return []

  const user = await getMockableUser()

  if (!user) return []

  const { data, error } = await supabase
    .from('notifications')
    .select(`
      *,
      actor:users!actor_id(id, full_name, avatar_url)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('Error fetching notifications:', error.message, error.details, error.hint)
    return []
  }

  return data || []
}

export async function createNotification(payload: {
    user_id: string;
    actor_id?: string;
    type: string;
    title: string;
    content?: string;
    link_url?: string;
}) {
    const supabase = await createClient()
    const orgId = await getDefaultOrgId(supabase)
    if (!orgId) return { error: 'No org found' }

    const { error } = await supabase.from('notifications').insert({
        organization_id: orgId,
        ...payload
    })

    if (error) {
        console.error('Error creating notification:', error)
        return { error: error.message }
    }
    
    // We don't necessarily revalidatePath here because supabase realtime handles UI updates naturally for notifications,
    // but just in case, we'll revalidate the layout. 
    revalidatePath('/', 'layout')
    return { success: true }
}

export async function markAsRead(notificationIds: string[]) {
    const supabase = await createClient()
    const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .in('id', notificationIds)
        .is('read_at', null)

    if (error) {
        console.error('Error marking notifications read:', error)
        return { error: error.message }
    }

    revalidatePath('/', 'layout')
    return { success: true }
}

export async function markAllAsRead() {
    const supabase = await createClient()
    let { data: { user } } = await supabase.auth.getUser()
    
    const cookieStore = await cookies()
    const isMockAuth = cookieStore.get('sb-mock-auth')?.value === 'true'

    if (!user && isMockAuth) {
        const { data: firstUser } = await supabase.from('users').select('id').limit(1).single()
        if (firstUser) user = { id: firstUser.id } as any
    }

    if (!user) return { error: 'Not authenticated' }

    const { error } = await supabase
        .from('notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .is('read_at', null)

    if (error) {
        console.error('Error marking all read:', error)
        return { error: error.message }
    }

    revalidatePath('/', 'layout')
    return { success: true }
}

export async function deleteNotification(notificationId: string) {
    const supabase = await createClient()
    const { error } = await supabase.from('notifications').delete().eq('id', notificationId)

    if (error) {
        console.error('Error deleting notification:', error)
        return { error: error.message }
    }

    revalidatePath('/', 'layout')
    return { success: true }
}
