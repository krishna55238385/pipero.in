'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { LayoutDashboard, Users, Share2, Bell, LineChart, ClipboardList, History, Settings, BellRing, ChevronLeft, ChevronDown, Sparkles, PhoneCall, Send, Workflow, Inbox, FileText, UserCheck } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

type NavChild = { name: string; href: string }
type NavItem =
    | { key: string; name: string; href: string; icon: React.ComponentType<{ className?: string }> }
    | { key: string; name: string; href: string; icon: React.ComponentType<{ className?: string }>; children: NavChild[] }

type NavSection = {
    label: string
    items: NavItem[]
}

const navSections: NavSection[] = [
    {
        label: 'Workspace',
        items: [
            { key: 'dashboard', name: 'Dashboard', href: '/home', icon: LayoutDashboard },
            { key: 'attendance', name: 'Attendance', href: '/attendance', icon: ClipboardList },
        ],
    },
    {
        label: 'Sales',
        items: [
            {
                key: 'engage',
                name: 'Engage',
                href: '/engage/inbox',
                icon: Send,
                children: [
                    { name: 'Inbox', href: '/engage/inbox' },
                    { name: 'Accounts', href: '/engage/accounts' },
                    { name: 'Sequences', href: '/engage/sequences' },
                    { name: 'Campaigns', href: '/engage/campaigns' },
                    { name: 'Templates', href: '/engage/templates' },
                    { name: 'Conversations', href: '/engage/conversations' },
                    { name: 'Analytics', href: '/engage/analytics' },
                    { name: 'Settings', href: '/engage/settings' },
                ],
            },
            { key: 'workflows', name: 'Workflows', href: '/workflows', icon: Workflow },
            {
                key: 'crm',
                name: 'CRM',
                href: '/contacts',
                icon: Users,
                children: [
                    { name: 'Contacts', href: '/contacts' },
                    { name: 'Leads', href: '/leads' },
                    { name: 'Companies', href: '/companies' },
                    { name: 'Customers', href: '/customers' },
                    { name: 'Deals', href: '/deals' },
                    { name: 'Lists', href: '/lists' },
                    { name: 'Tasks', href: '/tasks' },
                ],
            },
            {
                key: 'dialer',
                name: 'Dialer',
                href: '/dialer',
                icon: PhoneCall,
                children: [
                    { name: 'Workspace', href: '/dialer' },
                    { name: 'Dashboard', href: '/dialer/dashboard' },
                    { name: 'Recordings', href: '/dialer/recordings' },
                ],
            },
            { key: 'content', name: 'Content Library', href: '/content', icon: FileText },
            {
                key: 'prospects',
                name: 'Prospects',
                href: '/prospects/leads',
                icon: UserCheck,
                children: [
                    { name: 'ICP & Pipelines', href: '/prospects/icp' },
                    { name: 'Prospect Leads', href: '/prospects/leads' },
                    { name: 'Prospect Companies', href: '/prospects/companies' },
                    { name: 'Signals', href: '/prospects/signals' },
                    { name: 'Competitors', href: '/prospects/competitors' },
                    { name: 'Visitors', href: '/prospects/visitors' },
                    { name: 'AI Prospect Search', href: '/prospects/ai-search' },
                ],
            },
            { key: 'followups', name: 'Follow-ups', href: '/follow-ups', icon: BellRing },
        ],
    },
    {
        label: 'Administration',
        items: [
            { key: 'reps', name: 'Rep Monitor', href: '/reps', icon: Users },
            { key: 'analytics', name: 'Analytics', href: '/analytics', icon: LineChart },
            { key: 'forwarded', name: 'Forwarded', href: '/forwarded', icon: Share2 },
            { key: 'notifications', name: 'Notifications', href: '/notifications', icon: Bell },
            { key: 'leadlogs', name: 'Lead Logs', href: '/lead-logs', icon: History },
            { key: 'activity', name: 'Activity Log', href: '/activity-log', icon: History },
            { key: 'automations', name: 'Automations', href: '/settings/automations', icon: Inbox },
            { key: 'settings', name: 'Settings', href: '/settings', icon: Settings },
        ],
    },
]

function CollapsibleNavItem({
    item,
    pathname,
    isCollapsed,
    isParentActive,
    expanded,
    onToggle,
}: {
    item: Extract<NavItem, { children: NavChild[] }>
    pathname: string
    isCollapsed: boolean
    isParentActive: boolean
    expanded: boolean
    onToggle: () => void
}) {
    if (isCollapsed) {
        return (
            <li className="relative group">
                <Link
                    href={item.children[0].href}
                    title={item.name}
                    className="flex items-center justify-center p-2.5 rounded-lg transition-all duration-200 relative overflow-hidden text-muted-foreground hover:bg-accent hover:text-foreground font-medium"
                >
                    <item.icon className="h-[18px] w-[18px] transition-colors duration-200 group-hover:text-primary" />
                </Link>
            </li>
        )
    }
    return (
        <li className="relative">
            <button
                type="button"
                onClick={onToggle}
                className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg transition-all duration-200 relative overflow-hidden w-full text-left ${
                    isParentActive
                        ? 'bg-primary/8 text-primary font-semibold'
                        : 'text-muted-foreground font-medium hover:bg-accent/60 hover:text-foreground'
                }`}
            >
                <item.icon className="h-4 w-4 shrink-0 transition-colors duration-200" />
                <span className="truncate flex-1 text-[13px]">{item.name}</span>
                <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-40" />
                </motion.div>
            </button>
            <AnimatePresence>
                {expanded && (
                    <motion.ul
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden pl-4 mt-0.5 space-y-px border-l border-border/30 ml-[26px]"
                    >
                        {item.children.map((child) => {
                            const isChildActive = pathname.startsWith(child.href)
                            return (
                                <li key={child.href}>
                                    <Link
                                        href={child.href}
                                        className={`flex items-center gap-2 py-[5px] px-2.5 rounded-md text-[13px] transition-all duration-200 ${
                                            isChildActive
                                                ? 'bg-primary/8 text-primary font-semibold'
                                                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                                        }`}
                                    >
                                        <span className="truncate">{child.name}</span>
                                    </Link>
                                </li>
                            )
                        })}
                    </motion.ul>
                )}
            </AnimatePresence>
        </li>
    )
}

export function Sidebar({ workspaceName = 'Workspace' }: { workspaceName?: string }) {
    const pathname = usePathname()
    const [isCollapsed, setIsCollapsed] = useState(false)
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({})

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExpandedSections((prev) => ({
            ...prev,
            crm:
                (prev.crm ?? false) ||
                pathname.startsWith('/contacts') ||
                pathname.startsWith('/leads') ||
                pathname.startsWith('/companies') ||
                pathname.startsWith('/customers') ||
                pathname.startsWith('/deals') ||
                pathname.startsWith('/lists') ||
                pathname.startsWith('/tasks'),
            dialer: (prev.dialer ?? false) || pathname.startsWith('/dialer'),
            prospects: (prev.prospects ?? false) || pathname.startsWith('/prospects'),
            engage: (prev.engage ?? false) || pathname.startsWith('/engage'),
        }))
    }, [pathname])

    return (
        <motion.aside
            initial={false}
            animate={{
                width: isCollapsed ? '4.5rem' : '16rem',
            }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="bg-card/50 dark:bg-sidebar/95 backdrop-blur-xl text-foreground flex flex-col h-full border-r border-border/30 relative z-20"
        >
            {/* Header */}
            <div className="h-14 flex items-center justify-between px-4 border-b border-border/20 relative overflow-hidden shrink-0">
                <AnimatePresence mode="popLayout">
                    {!isCollapsed && (
                        <motion.div
                            initial={{ opacity: 0, x: -16 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -16, transition: { duration: 0.15 } }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="flex items-center gap-2.5 px-1"
                        >
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 via-blue-500 to-sky-400 flex items-center justify-center shrink-0 shadow-sm">
                                <Sparkles className="w-3.5 h-3.5 text-white" />
                            </div>
                            <span className="font-bold text-[15px] tracking-tight text-foreground truncate max-w-[130px]" title={workspaceName}>
                                {workspaceName}
                            </span>
                        </motion.div>
                    )}
                </AnimatePresence>

                <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors mx-auto shrink-0 z-10"
                >
                    <motion.div
                        animate={{ rotate: isCollapsed ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </motion.div>
                </motion.button>
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-none px-2 relative">
                {navSections.map((section, sectionIdx) => (
                    <div key={section.label} className={sectionIdx > 0 ? 'mt-4' : ''}>
                        {!isCollapsed && (
                            <div className="px-2.5 mb-1.5">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                    {section.label}
                                </span>
                            </div>
                        )}
                        {isCollapsed && sectionIdx > 0 && (
                            <div className="mx-2.5 mb-1 border-t border-border/20" />
                        )}
                        <ul className="space-y-px">
                            {section.items.map((item) => {
                                const hasChildren = 'children' in item && item.children?.length
                                const isParentActive = hasChildren && item.children.some((c) => pathname.startsWith(c.href))
                                const isActive = hasChildren
                                    ? false
                                    : item.href === '/home'
                                        ? pathname === '/home'
                                        : pathname.startsWith(item.href)

                                if (hasChildren && item.children) {
                                    return (
                                        <CollapsibleNavItem
                                            key={item.key}
                                            item={item}
                                            pathname={pathname}
                                            isCollapsed={isCollapsed}
                                            isParentActive={!!isParentActive}
                                            expanded={!!expandedSections[item.key]}
                                            onToggle={() => setExpandedSections((p) => ({ ...p, [item.key]: !p[item.key] }))}
                                        />
                                    )
                                }

                                return (
                                    <li key={item.key} className="relative group">
                                        {isActive && !isCollapsed && (
                                            <motion.div
                                                layoutId="activeTab"
                                                className="absolute left-0 w-[3px] h-4 bg-primary rounded-r-full top-1/2 -translate-y-1/2"
                                                initial={false}
                                                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                                            />
                                        )}
                                        <Link
                                            href={item.href}
                                            title={isCollapsed ? item.name : undefined}
                                            className={`flex items-center ${isCollapsed ? 'justify-center p-2.5' : 'gap-2.5 px-2.5 py-[7px]'} rounded-lg transition-all duration-200 relative overflow-hidden ${
                                                isActive
                                                    ? 'bg-primary/8 text-primary font-semibold'
                                                    : 'text-muted-foreground font-medium hover:bg-accent/60 hover:text-foreground'
                                            }`}
                                        >
                                            <item.icon
                                                className={`${isCollapsed ? 'h-[18px] w-[18px]' : 'h-4 w-4'} shrink-0 transition-colors duration-200 ${isActive ? 'text-primary' : 'group-hover:text-primary'}`}
                                            />
                                            <AnimatePresence mode="wait">
                                                {!isCollapsed && (
                                                    <motion.span
                                                        initial={{ opacity: 0, width: 0 }}
                                                        animate={{ opacity: 1, width: 'auto' }}
                                                        exit={{ opacity: 0, width: 0 }}
                                                        className="truncate relative z-10 origin-left text-[13px]"
                                                    >
                                                        {item.name}
                                                    </motion.span>
                                                )}
                                            </AnimatePresence>
                                        </Link>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                ))}
            </nav>

            {/* Footer */}
            <AnimatePresence>
                {!isCollapsed && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="px-4 py-3 text-xs text-muted-foreground shrink-0 truncate border-t border-border/20"
                        title={workspaceName}
                    >
                        <div className="flex items-center gap-2 mb-0.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_4px_oklch(0.65_0.19_155_/_0.4)]" />
                            <span className="font-medium text-foreground/60">System Online</span>
                        </div>
                        &copy; {new Date().getFullYear()} {workspaceName}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.aside>
    )
}
