import { Search, Bell } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { NotificationBell } from './NotificationBell'
import { getNotifications, getMockableUser } from '@/app/actions/notifications'
import { UserMenu } from './UserMenu'

export async function GlobalHeader() {
    const notifications = await getNotifications()
    const user = await getMockableUser()

    return (
        <header className="h-16 flex items-center justify-between px-6 border-b border-gray-200 dark:border-border bg-white/70 dark:bg-card/80 backdrop-blur-xl sticky top-0 z-50">
            <div className="flex-1 flex max-w-xl">
                <div className="relative w-full">
                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400 dark:text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search leads, deals, contacts..."
                        className="w-full bg-gray-100/50 dark:bg-muted/50 border border-gray-200 dark:border-border rounded-xl pl-10 pr-4 py-2 text-sm text-gray-900 dark:text-foreground placeholder:text-gray-500 dark:placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:bg-white dark:focus:bg-muted transition-all shadow-sm dark:shadow-none"
                    />
                </div>
            </div>
            <div className="flex items-center gap-6 text-gray-500 dark:text-muted-foreground">
                <div className="hidden md:block text-[13px] font-medium tracking-wide">
                    {new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <NotificationBell initialNotifications={notifications} userId={user?.id} />
                <ThemeToggle />
                <UserMenu fullName={user?.full_name} email={user?.email} />
            </div>
        </header>
    )
}

