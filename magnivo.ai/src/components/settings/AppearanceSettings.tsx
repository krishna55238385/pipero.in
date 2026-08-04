'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Sun, Moon, Check, Sparkles } from 'lucide-react'
import { useUI } from '@/components/providers/UIProvider'

export default function AppearanceSettings() {
    const { colorTheme, setColorTheme, density, setDensity, accentColor, setAccentColor } = useUI()

    const themes = [
        { id: 'white', name: 'Light', icon: Sun, desc: 'Clean, bright interface for well-lit environments.', color: '#ffffff', bgLabel: 'Light', bgLabelColor: '#3b82f6' },
        { id: 'blue', name: 'Dark', icon: Moon, desc: 'Comfortable dark mode that reduces eye strain.', color: '#0f1628', bgLabel: 'Dark', bgLabelColor: '#6366f1' },
    ]

    const accentColors = [
        { id: 'indigo', value: '#4f46e5', name: 'Indigo' },
        { id: 'blue', value: '#2563eb', name: 'Blue' },
        { id: 'emerald', value: '#10b981', name: 'Emerald' },
        { id: 'rose', value: '#f43f5e', name: 'Rose' },
        { id: 'amber', value: '#f59e0b', name: 'Amber' },
        { id: 'violet', value: '#7c3aed', name: 'Violet' },
    ]

    return (
        <div className="space-y-6 animate-fade-in pb-10">

            {/* Color Themes */}
            <Card>
                <CardHeader className="space-y-1">
                    <CardTitle className="text-lg font-semibold">Appearance</CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Choose between light and dark mode.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                    <div className="grid grid-cols-2 gap-4">
                        {themes.map((t) => {
                            const isActive = t.id === 'white'
                                ? colorTheme === 'white'
                                : colorTheme !== 'white'
                            const previewBg = t.id === 'white' ? '#f9fafb' : '#12182e'
                            const barBg = t.id === 'white' ? '#dde3f0' : '#ffffff18'

                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setColorTheme(t.id as any)}
                                    className={`group relative flex flex-col items-start gap-3 p-4 rounded-xl border transition-all duration-200 text-left overflow-hidden cursor-pointer ${
                                        isActive
                                            ? 'border-primary/50 shadow-sm ring-1 ring-primary/15'
                                            : 'border-border/30 hover:border-border/60'
                                    }`}
                                >
                                    <span
                                        className="absolute top-2 right-2 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full text-white/90"
                                        style={{ backgroundColor: t.bgLabelColor }}
                                    >
                                        {t.bgLabel}
                                    </span>

                                    <div className="w-full h-14 rounded-lg overflow-hidden border border-border/20 flex">
                                        <div className="w-1/3 h-full" style={{ backgroundColor: t.color }}></div>
                                        <div className="flex-1 h-full p-1.5 space-y-1.5" style={{ backgroundColor: previewBg }}>
                                            <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: barBg }}></div>
                                            <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: barBg }}></div>
                                            <div className="h-3.5 w-full rounded" style={{ backgroundColor: accentColor, opacity: 0.88 }}></div>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="font-semibold text-sm text-foreground leading-tight">{t.name}</p>
                                        <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t.desc}</p>
                                    </div>

                                    {isActive && (
                                        <div
                                            className="absolute top-2 left-2 w-4 h-4 rounded-full flex items-center justify-center"
                                            style={{ backgroundColor: accentColor }}
                                        >
                                            <Check className="w-2.5 h-2.5 text-white" />
                                        </div>
                                    )}
                                </button>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* Interface Density */}
            <Card>
                <CardHeader className="space-y-1">
                    <CardTitle className="text-lg font-semibold">Interface Density</CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Adjust the spacing of the sidebar and tables.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pb-6">
                    <div className="flex items-center gap-3">
                        {(['default', 'compact'] as const).map((d) => (
                            <button
                                key={d}
                                onClick={() => setDensity(d)}
                                className={`px-6 py-2 rounded-lg border transition-all duration-200 text-sm font-medium capitalize cursor-pointer ${
                                    density === d
                                        ? 'border-primary/50 bg-primary/5 text-primary ring-1 ring-primary/15'
                                        : 'border-border/30 text-muted-foreground hover:border-border/60 hover:text-foreground'
                                }`}
                            >
                                {d.charAt(0).toUpperCase() + d.slice(1)}
                            </button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Accent Color */}
            <Card>
                <CardHeader className="space-y-1">
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-500" />
                        Accent Color
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                        Customize the primary brand color across the system.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pb-6">
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                        {accentColors.map((color) => {
                            const active = accentColor === color.value
                            return (
                                <button
                                    key={color.id}
                                    onClick={() => setAccentColor(color.value)}
                                    className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all duration-200 cursor-pointer ${
                                        active
                                            ? 'border-border/40 bg-muted'
                                            : 'border-transparent hover:border-border/30'
                                    }`}
                                >
                                    <div
                                        className="w-8 h-8 rounded-full flex items-center justify-center transition-transform duration-200 group-hover:scale-110"
                                        style={{ backgroundColor: color.value }}
                                    >
                                        {active && <Check className="w-4 h-4 text-white" />}
                                    </div>
                                    <span className={`text-[11px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}>
                                        {color.name}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

        </div>
    )
}
