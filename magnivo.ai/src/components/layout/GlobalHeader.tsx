import { Search } from 'lucide-react'
import { ThemeToggle } from './ThemeToggle'
import { NotificationBell } from './NotificationBell'
import { getNotifications, getMockableUser } from '@/app/actions/notifications'
import { UserMenu } from './UserMenu'

export async function GlobalHeader() {
    const notifications = await getNotifications()
    const user = await getMockableUser()

    return (
        <header className="h-14 flex items-center justify-between px-6 border-b border-border/20 bg-background/80 backdrop-blur-xl sticky top-0 z-50">
            <div className="flex-1 flex max-w-3xl">
                <div className="relative w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search leads, deals, contacts..."
                        className="w-full bg-muted/40 border border-border/30 rounded-lg pl-10 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/8 transition-all duration-200"
                    />
                </div>
            </div>
            <div className="flex items-center gap-3 text-muted-foreground">
                <div className="hidden md:block text-[13px] font-medium tracking-wide text-foreground/50">
                    {new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                <NotificationBell initialNotifications={notifications} userId={user?.id} />
                <ThemeToggle />
                <UserMenu fullName={user?.full_name} email={user?.email} />
            </div>
        </header>
    )
}
