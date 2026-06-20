'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'

interface WorkspaceContextType {
    workspaceName: string;
    currency: string;
    timezone: string;
    userRole: string;
    permissions: any;
    isCoreAdmin: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType>({
    workspaceName: 'Workspace',
    currency: 'USD',
    timezone: '(UTC-05:00) Eastern Time',
    userRole: 'user',
    permissions: {},
    isCoreAdmin: false,
});

export function WorkspaceProvider({
    children,
    workspaceName,
    currency,
    timezone,
    userRole,
    permissions
}: {
    children: React.ReactNode,
    workspaceName?: string,
    currency?: string,
    timezone?: string,
    userRole?: string,
    permissions?: any
}) {
    const normalizedRole = (userRole || 'user').toLowerCase()
    const value = {
        workspaceName: workspaceName || 'Workspace',
        currency: currency || 'USD',
        timezone: timezone || '(UTC-05:00) Eastern Time',
        userRole: userRole || 'user',
        permissions: permissions || {},
        isCoreAdmin: normalizedRole === 'admin' || normalizedRole === 'super_admin',
    }

    return (
        <WorkspaceContext.Provider value={value}>
            {children}
        </WorkspaceContext.Provider>
    )
}

export function useWorkspace() {
    return useContext(WorkspaceContext)
}
