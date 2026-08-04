'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Bell, BellOff, Check, X, AlertTriangle, AlertCircle, Info, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import {
  getNotifications,
  markNotificationRead,
  dismissNotification,
} from '@/app/actions/deliverability'

type NotificationItem = {
  id: string
  organization_id: string
  domain_id: string
  notification_type: string
  title: string
  message: string
  severity: 'info' | 'warning' | 'critical'
  is_read: boolean
  is_dismissed: boolean
  previous_value: string | null
  new_value: string | null
  metadata: Record<string, unknown>
  created_at: string
}

const SEVERITY_CONFIG: Record<string, { icon: typeof AlertTriangle; color: string; bg: string; badge: string }> = {
  critical: { icon: AlertCircle, color: 'text-red-500', bg: 'bg-red-500/5 border-red-500/20', badge: 'bg-red-500/10 text-red-600' },
  warning: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/5 border-amber-500/20', badge: 'bg-amber-500/10 text-amber-600' },
  info: { icon: Info, color: 'text-blue-500', bg: 'bg-blue-500/5 border-blue-500/20', badge: 'bg-blue-500/10 text-blue-600' },
}

const TYPE_LABELS: Record<string, string> = {
  spf_break: 'SPF',
  dkim_expired: 'DKIM',
  dmarc_removed: 'DMARC',
  tracking_stopped: 'Tracking',
  health_degraded: 'Health',
  dns_timeout: 'DNS',
}

function NotificationEntry({
  notification,
  onMarkRead,
  onDismiss,
}: {
  notification: NotificationItem
  onMarkRead: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const config = SEVERITY_CONFIG[notification.severity] ?? SEVERITY_CONFIG.info
  const Icon = config.icon

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-lg border transition-colors',
        config.bg,
        !notification.is_read && 'ring-1 ring-primary/20'
      )}
    >
      <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', config.color)} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{notification.title}</span>
          <Badge variant="outline" className={cn('text-[10px] px-1 py-0', config.badge)}>
            {TYPE_LABELS[notification.notification_type] ?? notification.notification_type}
          </Badge>
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {notification.severity}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{notification.message}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}</span>
        </div>
      </div>
      <div className="flex items-start gap-1 shrink-0">
        {!notification.is_read && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => onMarkRead(notification.id)}
            title="Mark as read"
          >
            <Check className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => onDismiss(notification.id)}
          title="Dismiss"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

export function DeliverabilityNotificationsPanel() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [showUnreadOnly, setShowUnreadOnly] = useState(true)
  const [isLoading, setIsLoading] = useState(true)

  const loadNotifications = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getNotifications(showUnreadOnly)
      setNotifications(data as NotificationItem[])
    } finally {
      setIsLoading(false)
    }
  }, [showUnreadOnly])

  useEffect(() => { loadNotifications() }, [loadNotifications])

  const handleMarkRead = async (id: string) => {
    await markNotificationRead(id)
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    )
  }

  const handleDismiss = async (id: string) => {
    await dismissNotification(id)
    setNotifications((prev) => prev.filter((n) => n.id !== id))
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
            {unreadCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {unreadCount} unread
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showUnreadOnly ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-xs"
              onClick={() => setShowUnreadOnly(true)}
            >
              Unread
            </Button>
            <Button
              variant={!showUnreadOnly ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-xs"
              onClick={() => setShowUnreadOnly(false)}
            >
              All
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading ? (
          <div className="text-center py-6 text-xs text-muted-foreground">Loading notifications...</div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-6">
            <BellOff className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">
              {showUnreadOnly ? 'No unread notifications' : 'No notifications'}
            </p>
          </div>
        ) : (
          notifications.map((notification) => (
            <NotificationEntry
              key={notification.id}
              notification={notification}
              onMarkRead={handleMarkRead}
              onDismiss={handleDismiss}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}
