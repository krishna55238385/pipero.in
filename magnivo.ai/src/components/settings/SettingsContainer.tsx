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
    ChevronRight,
} from 'lucide-react'
import MyProfile from './MyProfile'
import NotificationPreferences from './NotificationPreferences'
import WorkspaceSettings from './WorkspaceSettings'
import UsersAndRoles from './UsersAndRoles'
import LeadManagement from './LeadManagement'
import AppearanceSettings from './AppearanceSettings'
import ApiKeysSettings from './ApiKeysSettings'

const NAV_ITEMS = [
    {
        section: 'Personal', items: [
            { id: 'profile', name: 'My Profile', icon: User },
            { id: 'appearance', name: 'Appearance', icon: Palette },
            { id: 'notifications', name: 'Notifications', icon: Bell },
        ]
    },
    {
        section: 'Workspace', items: [
            { id: 'workspace', name: 'Workspace', icon: Building },
            { id: 'users', name: 'Users & Roles', icon: UsersIcon },
            { id: 'leads', name: 'Lead Management', icon: Link },
            { id: 'ai', name: 'Automation & AI', icon: Bot },
        ]
    },
    {
        section: 'System', items: [
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
            case 'ai': return <ApiKeysSettings />
            default: return (
                <div className="h-80 flex flex-col items-center justify-center rounded-xl bg-muted/30 animate-fade-in">
                    <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mb-3">
                        <Shield className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground">Coming Soon</h3>
                    <p className="text-xs text-muted-foreground max-w-[200px] text-center mt-1">
                        This module is under development.
                    </p>
                </div>
            )
        }
    }

    return (
        <div className="min-h-[calc(100vh-3.5rem)] bg-background transition-colors duration-300">
            <div className="flex flex-col sm:flex-row p-4 sm:p-6 lg:p-8 gap-6 lg:gap-10 max-w-[1400px] mx-auto w-full">
                {/* Sidebar Navigation */}
                <div className="w-full sm:w-52 lg:w-56 space-y-6 flex-shrink-0">
                    <div className="space-y-1">
                        <h1 className="text-xl font-bold tracking-tight text-foreground">Settings</h1>
                        <p className="text-sm text-muted-foreground">Manage your preferences.</p>
                    </div>

                    <nav className="space-y-5">
                        {NAV_ITEMS.map((section) => (
                            <div key={section.section} className="space-y-0.5">
                                <div className="px-2.5 mb-1.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
                                        {section.section}
                                    </span>
                                </div>
                                {section.items.map((item) => {
                                    const active = activeTab === item.id
                                    return (
                                        <button
                                            key={item.id}
                                            onClick={() => setActiveTab(item.id)}
                                            className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg transition-all duration-200 font-medium text-[13px] cursor-pointer ${
                                                active
                                                    ? 'bg-primary/8 text-primary'
                                                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/60'
                                            }`}
                                        >
                                            <item.icon className={`w-4 h-4 ${active ? 'text-primary' : ''}`} />
                                            {item.name}
                                            {active && <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-30" />}
                                        </button>
                                    )
                                })}
                            </div>
                        ))}
                    </nav>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 max-w-4xl min-w-0">
                    {renderContent()}
                </div>
            </div>
        </div>
    )
}
