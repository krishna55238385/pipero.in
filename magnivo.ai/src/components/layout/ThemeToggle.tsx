"use client"

import { useUI } from "@/components/providers/UIProvider"
import { Sun, Moon } from "lucide-react"

function useUISafe() {
    try {
        return useUI()
    } catch {
        return null
    }
}

export function ThemeToggle() {
    const context = useUISafe()

    if (!context) {
        return (
            <button
                type="button"
                title="Theme (unavailable)"
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 hover:bg-accent cursor-pointer"
            >
                <Sun className="w-4 h-4 text-muted-foreground" />
                <span className="sr-only">Theme</span>
            </button>
        )
    }

    const { colorTheme, setColorTheme } = context
    const isDark = colorTheme !== 'white'

    return (
        <button
            onClick={() => setColorTheme(isDark ? 'white' : 'blue')}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200 hover:bg-accent active:scale-95 cursor-pointer"
        >
            {isDark ? (
                <Sun className="w-4 h-4 text-muted-foreground transition-transform duration-300" />
            ) : (
                <Moon className="w-4 h-4 text-muted-foreground transition-transform duration-300" />
            )}
            <span className="sr-only">
                {isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            </span>
        </button>
    )
}
