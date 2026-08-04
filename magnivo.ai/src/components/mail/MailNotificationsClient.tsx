'use client'

import { useCallback, useEffect, useState } from 'react'
import { MailPageHeader } from '@/components/mail/MailPageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bell, Check, X } from 'lucide-react'
import {
  getNotifications,
  markNotificationRead,
  dismissNotification,
} from '@/app/actions/deliverability'

type Notif = {
  id: string
  title?: string
  message?: string
  severity?: string
  isRead?: boolean
  is_read?: boolean
  createdAt?: string
  created_at?: string
  notificationType?: string
  notification_type?: string
}

export default function MailNotificationsClient() {
  const [items, setItems] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadOnly, setUnreadOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const data = (await getNotifications(unreadOnly)) as Notif[]
    setItems(data || [])
    setLoading(false)
  }, [unreadOnly])

  useEffect(() => {
    void load()
  }, [load])

  async function markRead(id: string) {
    await markNotificationRead(id)
    await load()
  }

  async function dismiss(id: string) {
    await dismissNotification(id)
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <MailPageHeader
          title="Notification Center"
          description="Deliverability alerts, health warnings, and DNS change notices"
        />
        <Button variant="outline" size="sm" onClick={() => setUnreadOnly((v) => !v)}>
          {unreadOnly ? 'Show all' : 'Unread only'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="h-4 w-4" /> Alerts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading...</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Bell className="h-10 w-10 mb-2 opacity-40" />
              <p className="text-sm">No notifications</p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((n) => {
                const read = Boolean(n.isRead ?? n.is_read)
                return (
                  <div key={n.id} className={`px-4 py-3 flex gap-3 ${read ? 'opacity-70' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{n.title || 'Alert'}</p>
                        <Badge variant="outline">{n.severity || 'info'}</Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {n.notificationType || n.notification_type || 'system'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{n.message}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {n.createdAt || n.created_at
                          ? new Date(String(n.createdAt || n.created_at)).toLocaleString()
                          : ''}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {!read && (
                        <Button size="icon" variant="ghost" onClick={() => void markRead(n.id)} aria-label="Mark read">
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => void dismiss(n.id)} aria-label="Dismiss">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
