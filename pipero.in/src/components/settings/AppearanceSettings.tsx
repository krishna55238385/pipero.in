'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Monitor, Moon, Sun, Check, Sparkles } from 'lucide-react'
import { useUI } from '@/components/providers/UIProvider'

export default function AppearanceSettings() {
    const { colorTheme, setColorTheme, density, setDensity, accentColor, setAccentColor } = useUI()

    const themes = [
        { id: 'white', name: 'White', icon: Sun, desc: 'Clean pristine light.', color: '#ffffff', bgLabel: 'Light', bgLabelColor: '#3b82f6' },
        { id: 'slate', name: 'Slate', icon: Monitor, desc: 'Cool-toned soft light.', color: '#eef1f7', bgLabel: 'Light', bgLabelColor: '#6366f1' },
        { id: 'gray', name: 'Gray', icon: Monitor, desc: 'Mid-tone dim mode.', color: '#484848', bgLabel: 'Mid', bgLabelColor: '#6b7280' },
        { id: 'blue', name: 'Blue', icon: Moon, desc: 'Deep navy night mode.', color: '#0f1628', bgLabel: 'Dark', bgLabelColor: '#3b82f6' },
        { id: 'black', name: 'Black', icon: Moon, desc: 'Midnight OLED black.', color: '#0a0a0a', bgLabel: 'Dark', bgLabelColor: '#374151' },
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
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 pb-10">

            {/* ── Color Themes ── */}
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl overflow-hidden">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-2xl font-semibold">Color Themes</CardTitle>
                    <CardDescription className="text-slate-500 dark:text-muted-foreground">
                        Select your preferred brand environment. Light, mid, or dark.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                    {/* 5-theme grid: 2-col mobile → 5-col wide */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {themes.map((t) => {
                            const active = colorTheme === t.id
                            const isLight = t.id === 'white' || t.id === 'slate'
                            const previewBg = {
                                white: '#f9fafb',
                                slate: '#edf0f9',
                                gray: '#383838',
                                blue: '#12182e',
                                black: '#0d0d0d',
                            }[t.id] ?? '#f9fafb'
                            const barBg = isLight ? '#dde3f0' : '#ffffff18'

                            return (
                                <button
                                    key={t.id}
                                    onClick={() => setColorTheme(t.id as any)}
                                    className={`relative flex flex-col items-start gap-3 p-4 rounded-2xl border-2 transition-all text-left overflow-hidden ${active
                                            ? 'bg-indigo-50/10 dark:bg-indigo-500/5'
                                            : 'border-slate-100 dark:border-border bg-white dark:bg-card hover:border-slate-300 dark:hover:border-border/80'
                                        }`}
                                    style={{ borderColor: active ? accentColor : undefined }}
                                >
                                    {/* Mode badge */}
                                    <span
                                        className="absolute top-2 right-2 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full text-white/90"
                                        style={{ backgroundColor: t.bgLabelColor }}
                                    >
                                        {t.bgLabel}
                                    </span>

                                    {/* Mini CRM preview swatch */}
                                    <div className="w-full h-14 rounded-xl overflow-hidden border border-slate-200/60 dark:border-white/5 shadow-sm flex">
                                        {/* Sidebar strip */}
                                        <div className="w-1/3 h-full" style={{ backgroundColor: t.color }}></div>
                                        {/* Content area */}
                                        <div className="flex-1 h-full p-1.5 space-y-1.5" style={{ backgroundColor: previewBg }}>
                                            <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: barBg }}></div>
                                            <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: barBg }}></div>
                                            <div className="h-3.5 w-full rounded" style={{ backgroundColor: accentColor, opacity: 0.88 }}></div>
                                        </div>
                                    </div>

                                    {/* Label */}
                                    <div>
                                        <p className="font-bold text-sm text-slate-900 dark:text-foreground leading-tight">{t.name}</p>
                                        <p className="text-[10px] text-slate-500 dark:text-muted-foreground leading-snug mt-0.5">{t.desc}</p>
                                    </div>

                                    {/* Active checkmark */}
                                    {active && (
                                        <div
                                            className="absolute top-2 left-2 w-4 h-4 rounded-full flex items-center justify-center shadow-md"
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

            {/* ── Interface Density ── */}
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl overflow-hidden">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-lg font-semibold">Interface Density</CardTitle>
                    <CardDescription className="text-slate-500 dark:text-muted-foreground">
                        Adjust the spacing of the sidebar and tables.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pb-8">
                    <div className="flex items-center gap-4">
                        {(['default', 'compact'] as const).map((d) => (
                            <button
                                key={d}
                                onClick={() => setDensity(d)}
                                className={`px-8 py-2.5 rounded-lg border-2 transition-all text-sm font-bold capitalize ${density === d
                                    ? 'bg-indigo-50/50 dark:bg-indigo-500/10'
                                    : 'bg-white dark:bg-card border-slate-100 dark:border-border text-slate-500'
                                    }`}
                                style={{
                                    borderColor: density === d ? accentColor : undefined,
                                    color: density === d ? accentColor : undefined
                                }}
                            >
                                {d.charAt(0).toUpperCase() + d.slice(1)}
                            </button>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* ── System Accent Color ── */}
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl overflow-hidden border-dashed border-2">
                <CardHeader className="space-y-1">
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-amber-500" />
                        System Accent Color
                    </CardTitle>
                    <CardDescription className="text-slate-500 dark:text-muted-foreground">
                        Customize the primary brand color across the entire system.
                    </CardDescription>
                </CardHeader>
                <CardContent className="pb-8">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                        {accentColors.map((color) => {
                            const active = accentColor === color.value
                            return (
                                <button
                                    key={color.id}
                                    onClick={() => setAccentColor(color.value)}
                                    className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${active
                                            ? 'bg-slate-50 dark:bg-secondary/50'
                                            : 'border-transparent hover:border-slate-100 dark:hover:border-border'
                                        }`}
                                    style={{ borderColor: active ? color.value : undefined }}
                                >
                                    <div
                                        className="w-10 h-10 rounded-full shadow-inner flex items-center justify-center transition-transform group-hover:scale-110"
                                        style={{ backgroundColor: color.value }}
                                    >
                                        {active && <Check className="w-5 h-5 text-white" />}
                                    </div>
                                    <span className={`text-[11px] font-bold ${active ? 'text-slate-900 dark:text-foreground' : 'text-slate-500'}`}>
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
