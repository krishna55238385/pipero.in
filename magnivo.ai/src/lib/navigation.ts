'use client'

import type React from 'react'
import {
    LayoutDashboard,
    ClipboardList,
    Send,
    Users,
    PhoneCall,
    FileText,
    UserCheck,
    BellRing,
    LineChart,
    Bell,
    History,
    Settings,
    Share2,
} from 'lucide-react'

export type NavChild = { name: string; href: string }
export type NavItem =
    | { key: string; name: string; href: string; icon: React.ComponentType<{ className?: string }> }
    | { key: string; name: string; href: string; icon: React.ComponentType<{ className?: string }>; children: NavChild[] }

export type NavSection = {
    label: string
    items: NavItem[]
}

export const navSections: NavSection[] = [
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
                href: '/engage',
                icon: Send,
                children: [
                    { name: 'Overview', href: '/engage' },
                    { name: 'Inbox', href: '/engage/inbox' },
                    { name: 'Accounts', href: '/engage/accounts' },
                    { name: 'Pools', href: '/engage/pools' },
                    { name: 'Domains', href: '/engage/domains' },
                    { name: 'Tracking Domains', href: '/engage/tracking-domains' },
                    { name: 'Deliverability', href: '/engage/deliverability' },
                    { name: 'Warmup', href: '/engage/warmup' },
                    { name: 'Sequences', href: '/engage/sequences' },
                    { name: 'Campaigns', href: '/engage/campaigns' },
                    { name: 'Templates', href: '/engage/templates' },
                    { name: 'Conversations', href: '/engage/conversations' },
                    { name: 'Leads', href: '/engage/leads' },
                    { name: 'Verification', href: '/engage/verification' },
                    { name: 'Suppression', href: '/engage/suppression' },
                    { name: 'Analytics', href: '/engage/analytics' },
                    { name: 'Reports', href: '/engage/reports' },
                    { name: 'Operations', href: '/engage/operations' },
                    { name: 'Audit Logs', href: '/engage/audit' },
                    { name: 'Team', href: '/engage/team' },
                    { name: 'Notifications', href: '/engage/notifications' },
                    { name: 'Compliance', href: '/engage/compliance' },
                    { name: 'Settings', href: '/engage/settings' },
                ],
            },
        ],
    },
    {
        label: 'CRM',
        items: [
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
            { key: 'contacts', name: 'Contacts', href: '/contacts', icon: Users },
            { key: 'leads', name: 'Leads', href: '/leads', icon: Users },
            { key: 'companies', name: 'Companies', href: '/companies', icon: Users },
            { key: 'customers', name: 'Customers', href: '/customers', icon: Users },
            { key: 'deals', name: 'Deals', href: '/deals', icon: Users },
            { key: 'lists', name: 'Lists', href: '/lists', icon: Users },
            { key: 'tasks', name: 'Tasks', href: '/tasks', icon: Users },
            { key: 'followups', name: 'Follow-ups', href: '/follow-ups', icon: BellRing },
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
            { key: 'forwarded', name: 'Forwarded', href: '/forwarded', icon: Share2 },
        ],
    },
    {
        label: 'Administration',
        items: [
            { key: 'reps', name: 'Rep Monitor', href: '/reps', icon: Users },
            { key: 'analytics', name: 'Analytics', href: '/analytics', icon: LineChart },
            { key: 'notifications', name: 'Notifications', href: '/notifications', icon: Bell },
            { key: 'leadlogs', name: 'Lead Logs', href: '/lead-logs', icon: History },
            { key: 'activity', name: 'Activity Log', href: '/activity-log', icon: History },
            { key: 'automations', name: 'Automations', href: '/settings/automations', icon: Settings },
            { key: 'settings', name: 'Settings', href: '/settings', icon: Settings },
        ],
    },
]

function matchNavChild(pathname: string, children: NavChild[]): NavChild | null {
    const matches = children.filter(
        (c) => pathname === c.href || pathname.startsWith(c.href + '/') || pathname.startsWith(c.href + '?')
    )
    if (matches.length === 0) return null
    return matches.reduce((best, c) => (c.href.length > best.href.length ? c : best))
}

export function getBreadcrumbs(pathname: string): { label: string; href?: string }[] {
    for (const section of navSections) {
        for (const item of section.items) {
            if ('children' in item && item.children) {
                const child = matchNavChild(pathname, item.children)
                if (child) {
                    return [
                        { label: section.label },
                        { label: item.name, href: item.href },
                        { label: child.name },
                    ]
                }
                if (pathname === item.href || pathname.startsWith(item.href + '/') || pathname.startsWith(item.href + '?')) {
                    return [
                        { label: section.label },
                        { label: item.name },
                    ]
                }
            } else {
                if (pathname === item.href || pathname.startsWith(item.href + '/') || pathname.startsWith(item.href + '?')) {
                    return [
                        { label: section.label },
                        { label: item.name },
                    ]
                }
            }
        }
    }
    return []
}
