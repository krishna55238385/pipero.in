import { getNotifications } from '@/app/actions/notifications'
import { getMockableUser } from '@/app/actions/notifications'
import { NotificationsClient } from '@/components/notifications/NotificationsClient'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
    const [initialNotifications, user] = await Promise.all([
        getNotifications(),
        getMockableUser()
    ])

    return <NotificationsClient initialData={initialNotifications} userId={user?.id} />
}
