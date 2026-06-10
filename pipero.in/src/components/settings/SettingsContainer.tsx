'use client'

import { useState } from 'react'
import {
    User,
    Palette,
    Bell,
    Building,
    Users as UsersIcon,
    Link,
    Bot,
    Shield,
    Search,
    ChevronRight,
    Search as SearchIcon
} from 'lucide-react'
import MyProfile from './MyProfile'
import NotificationPreferences from './NotificationPreferences'
import WorkspaceSettings from './WorkspaceSettings'
import UsersAndRoles from './UsersAndRoles'
import LeadManagement from './LeadManagement'
import AppearanceSettings from './AppearanceSettings'

const NAV_ITEMS = [
    {
        section: 'PERSONAL', items: [
            { id: 'profile', name: 'My Profile', icon: User },
            { id: 'appearance', name: 'Appearance', icon: Palette },
            { id: 'notifications', name: 'Notifications', icon: Bell },
        ]
    },
    {
        section: 'WORKSPACE', items: [
            { id: 'workspace', name: 'Workspace', icon: Building },
            { id: 'users', name: 'Users & Roles', icon: UsersIcon },
            { id: 'leads', name: 'Lead Management', icon: Link },
            { id: 'ai', name: 'Automation & AI', icon: Bot },
        ]
    },
    {
        section: 'SYSTEM', items: [
            { id: 'security', name: 'Security', icon: Shield },
        ]
    }
]

export default function SettingsContainer({
    currentUser,
    initialOrg,
    initialMembers,
    initialInvites = []
}: {
    currentUser: any,
    initialOrg: any,
    initialMembers: any[],
    initialInvites?: any[]
}) {
    const [activeTab, setActiveTab] = useState('profile')

    const renderContent = () => {
        switch (activeTab) {
            case 'profile': return <MyProfile user={currentUser} />
            case 'appearance': return <AppearanceSettings />
            case 'notifications': return <NotificationPreferences initialPrefs={currentUser?.notification_preferences} />
            case 'workspace': return <WorkspaceSettings initialData={initialOrg} />
            case 'users': return <UsersAndRoles members={initialMembers} invites={initialInvites} />
            case 'leads': return <LeadManagement />
            default: return (
                <div className="h-96 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-border rounded-3xl bg-slate-50/50 dark:bg-card/50">
                    <div className="p-4 bg-white dark:bg-card rounded-2xl shadow-sm mb-4">
                        <Shield className="w-8 h-8 text-slate-300 dark:text-slate-700" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-foreground">Module Coming Soon</h3>
                    <p className="text-sm text-slate-500 dark:text-muted-foreground max-w-xs text-center mt-2">
                        We are building this domain to enterprise specifications. Check back shortly.
                    </p>
                </div>
            )
        }
    }

    return (
        <div className="min-h-screen bg-[#f8fafc] dark:bg-background transition-colors duration-300">
            <div className="flex p-8 gap-12 max-w-[1600px] mx-auto w-full">
                {/* Sidebar Navigation */}
                <div className="w-64 space-y-8 flex-shrink-0">
                    <div className="space-y-1">
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-foreground">Settings</h1>
                        <p className="text-sm font-medium text-slate-500 dark:text-muted-foreground">Manage your personal and workspace settings.</p>
                    </div>

                    <nav className="space-y-8 mt-12">
                        {NAV_ITEMS.map((section) => (
                            <div key={section.section} className="space-y-1.5">
                                <div className="h-px bg-slate-100 dark:bg-secondary my-4" />
                                {section.items.map((item) => {
                                    const active = activeTab === item.id
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id)}
                                            className={`w-full flex items-center gap-3.5 p-2.5 px-4 rounded-xl transition-all group font-medium text-sm ${active
                                                ? 'bg-white dark:bg-card shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)] text-[#4f46e5] ring-1 ring-slate-200 dark:ring-slate-800'
                                                : 'text-slate-500 dark:text-muted-foreground hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-900/50'
                                                }`}
                                        >
                                            <item.icon className={`w-4.5 h-4.5 ${active ? 'text-[#4f46e5]' : 'text-slate-400 dark:text-slate-600 group-hover:text-slate-600 dark:group-hover:text-slate-400'}`} />
                                            {item.name}
                                            {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-50" />}
                                        </button>
                                    )
                                })}
                            </div>
                        ))}
                    </nav>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 max-w-4xl">
                    {renderContent()}
                </div>
            </div>
        </div>
    )
}

