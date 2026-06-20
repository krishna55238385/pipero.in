'use client'

import React, { createContext, useContext, useEffect, useState } from 'react'
import { updateAppearanceSettings } from '@/app/actions/crm'

export type Density = 'default' | 'compact'
export type ColorTheme = 'white' | 'slate' | 'gray' | 'blue' | 'black'

interface UIContextType {
    density: Density
    accentColor: string
    colorTheme: ColorTheme
    setDensity: (d: Density) => void
    setAccentColor: (c: string) => void
    setColorTheme: (t: ColorTheme) => void
}

const UIContext = createContext<UIContextType | undefined>(undefined)



export function UIProvider({
    children,
    initialSettings
}: {
    children: React.ReactNode
    initialSettings?: { density?: Density, accent_color?: string, color_theme?: ColorTheme }
}) {
    const [density, setDensityState] = useState<Density>(initialSettings?.density || 'default')
    const [accentColor, setAccentColorState] = useState(initialSettings?.accent_color || '#4f46e5')
    const [colorTheme, setColorThemeState] = useState<ColorTheme>(initialSettings?.color_theme || 'white')

    useEffect(() => {
        const el = document.documentElement

        // Apply density
        el.setAttribute('data-density', density)

        // Apply the color theme attribute (drives our CSS palettes)
        el.setAttribute('data-color-theme', colorTheme)

        // Sync the .dark class — needed so dark: Tailwind variants apply for themed surfaces
        // Slate adds .dark too (its variables are light-valued, but dark: variants must fire to override hardcoded bg-white)
        if (colorTheme === 'white') {
            el.classList.remove('dark')
        } else {
            el.classList.add('dark')
        }

        // Apply accent color CSS variable
        el.style.setProperty('--primary-accent', accentColor)

        // Persist to localStorage so the inline script can apply on next page load (prevents flash)
        try {
            localStorage.setItem('crm-appearance', JSON.stringify({ color_theme: colorTheme, density, accent_color: accentColor }))
        } catch (e) { }

    }, [density, accentColor, colorTheme])

    const setDensity = async (d: Density) => {
        setDensityState(d)
        try {
            await updateAppearanceSettings({ density: d, accent_color: accentColor, color_theme: colorTheme })
        } catch (error) {
            console.error('Failed to save density setting:', error)
        }
    }

    const setAccentColor = async (c: string) => {
        setAccentColorState(c)
        try {
            await updateAppearanceSettings({ density, accent_color: c, color_theme: colorTheme })
        } catch (error) {
            console.error('Failed to save accent color:', error)
        }
    }

    const setColorTheme = async (t: ColorTheme) => {
        setColorThemeState(t) // triggers useEffect → updates data-color-theme + dark class
        try {
            await updateAppearanceSettings({ density, accent_color: accentColor, color_theme: t })
        } catch (error) {
            console.error('Failed to save color theme:', error)
        }
    }

    return (
        <UIContext.Provider value={{ density, accentColor, colorTheme, setDensity, setAccentColor, setColorTheme }}>
            {children}
        </UIContext.Provider>
    )
}

export const useUI = () => {
    const context = useContext(UIContext)
    if (!context) throw new Error('useUI must be used within UIProvider')
    return context
}

