'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { updateUserProfile } from '@/app/actions/crm'
import { toast } from 'sonner'
import { Loader2, Eye, EyeOff, User, Mail, Phone, Briefcase, Building2, FileText, Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'

// Defined outside component to prevent remount on every render
function Field({ label, icon: Icon, children }: { label: string, icon: any, children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <Label className="text-sm font-semibold dark:text-foreground flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5 text-slate-400 dark:text-muted-foreground" />
                {label}
            </Label>
            {children}
        </div>
    )
}

export default function MyProfile({ user }: { user: any }) {
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmPassword, setShowConfirmPassword] = useState(false)
    const [formData, setFormData] = useState({
        full_name: user?.full_name || '',
        email: user?.email || '',
        phone: user?.phone || '',
        designation: user?.designation || '',
        department: user?.department || '',
        bio: user?.bio || '',
        password: '',
        confirm_password: '',
        avatar_url: user?.avatar_url || ''
    })

    const update = (field: string, value: string) => setFormData(prev => ({ ...prev, [field]: value }))

    const handleSave = async () => {
        if (formData.password && formData.password !== formData.confirm_password) {
            toast.error("Passwords do not match")
            return
        }
        if (formData.password && formData.password.length < 8) {
            toast.error("Password must be at least 8 characters")
            return
        }

        setLoading(true)
        try {
            const emailChanged = formData.email !== user.email
            await updateUserProfile({
                full_name: formData.full_name,
                email: emailChanged ? formData.email : undefined, // only send if changed
                phone: formData.phone,
                designation: formData.designation,
                department: formData.department,
                bio: formData.bio,
                password: formData.password || undefined,
            })
            toast.success("Profile updated successfully!")
            if (emailChanged) {
                toast.info("A verification email has been sent to your new address.")
            }
            router.refresh()
            setFormData(prev => ({ ...prev, password: '', confirm_password: '' }))
        } catch (error: any) {
            toast.error(error.message || "Failed to update profile")
        } finally {
            setLoading(false)
        }
    }


    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500 max-w-3xl">

            {/* ── Avatar + basic info ── */}
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl">
                <CardHeader>
                    <CardTitle className="text-2xl font-semibold dark:text-foreground">My Profile</CardTitle>
                    <CardDescription className="dark:text-muted-foreground">
                        Manage your personal information. All changes are saved to the database.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">

                    {/* Avatar row */}
                    <div className="flex items-center gap-5 p-4 bg-slate-50 dark:bg-secondary/20 rounded-xl border border-slate-100 dark:border-border">
                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-secondary flex items-center justify-center border-2 border-white dark:border-card shadow-md overflow-hidden shrink-0">
                            {user?.avatar_url ? (
                                <img src={user.avatar_url} alt="Avatar" className="w-full h-full object-cover" />
                            ) : (
                                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${formData.full_name || 'User'}`} alt="Avatar" className="w-full h-full" />
                            )}
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900 dark:text-foreground">{formData.full_name || 'Your Name'}</p>
                            <p className="text-sm text-slate-500 dark:text-muted-foreground">{formData.designation || 'No designation set'}</p>
                            <p className="text-xs text-slate-400 dark:text-muted-foreground mt-0.5">{user?.role || 'user'} · {formData.department || 'No department'}</p>
                        </div>
                        <Button variant="outline" size="sm" className="ml-auto dark:border-border">Change Photo</Button>
                    </div>

                    {/* ── Personal Information ── */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 dark:text-muted-foreground uppercase tracking-widest mb-4">Personal Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <Field label="Full Name" icon={User}>
                                <Input
                                    value={formData.full_name}
                                    onChange={(e) => update('full_name', e.target.value)}
                                    placeholder="Your full name"
                                    className="h-10 dark:border-border dark:bg-background/50"
                                />
                            </Field>
                            <Field label="Email Address" icon={Mail}>
                                <Input
                                    type="email"
                                    value={formData.email}
                                    onChange={(e) => update('email', e.target.value)}
                                    placeholder="your@email.com"
                                    className="h-10 dark:border-border dark:bg-background/50"
                                />
                            </Field>
                            <Field label="Phone Number" icon={Phone}>
                                <Input
                                    type="tel"
                                    value={formData.phone}
                                    onChange={(e) => update('phone', e.target.value)}
                                    placeholder="+91 98765 43210"
                                    className="h-10 dark:border-border dark:bg-background/50"
                                />
                            </Field>
                        </div>
                    </div>

                    {/* ── Professional Details ── */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 dark:text-muted-foreground uppercase tracking-widest mb-4">Professional Details</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <Field label="Job Title / Designation" icon={Briefcase}>
                                <Input
                                    value={formData.designation}
                                    onChange={(e) => update('designation', e.target.value)}
                                    placeholder="e.g. Senior Sales Manager"
                                    className="h-10 dark:border-border dark:bg-background/50"
                                />
                            </Field>
                            <Field label="Department" icon={Building2}>
                                <Input
                                    value={formData.department}
                                    onChange={(e) => update('department', e.target.value)}
                                    placeholder="e.g. Sales, Marketing, Operations"
                                    className="h-10 dark:border-border dark:bg-background/50"
                                />
                            </Field>
                            <div className="space-y-2 md:col-span-2">
                                <Label className="text-sm font-semibold dark:text-foreground flex items-center gap-1.5">
                                    <FileText className="w-3.5 h-3.5 text-slate-400 dark:text-muted-foreground" />
                                    Bio / About Me
                                </Label>
                                <Textarea
                                    value={formData.bio}
                                    onChange={(e) => update('bio', e.target.value)}
                                    placeholder="A brief description about yourself, your experience, or your role..."
                                    className="resize-none h-24 dark:border-border dark:bg-background/50"
                                />
                                <p className="text-xs text-slate-400 dark:text-muted-foreground">{formData.bio.length}/300 characters</p>
                            </div>
                        </div>
                    </div>

                    {/* ── CRM Role (read-only) ── */}
                    <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-secondary/20 rounded-xl border border-slate-100 dark:border-border">
                        <div>
                            <p className="text-sm font-semibold dark:text-foreground">CRM Role</p>
                            <p className="text-xs text-slate-500 dark:text-muted-foreground mt-0.5">Your access level in this CRM. Contact an admin to change this.</p>
                        </div>
                        <span className="text-xs font-bold uppercase px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-500/20">
                            {user?.role || 'user'}
                        </span>
                    </div>

                </CardContent>
                <CardFooter className="bg-slate-50/50 dark:bg-secondary/10 border-t border-slate-100 dark:border-border flex justify-end px-6 py-4">
                    <Button onClick={handleSave} disabled={loading} className="px-8">
                        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</> : 'Save Changes'}
                    </Button>
                </CardFooter>
            </Card>

            {/* ── Change Password ── */}
            <Card className="bg-white dark:bg-card border-slate-200 dark:border-border shadow-sm rounded-xl">
                <CardHeader>
                    <CardTitle className="text-lg font-semibold dark:text-foreground flex items-center gap-2">
                        <Lock className="w-5 h-5 text-slate-400" />
                        Change Password
                    </CardTitle>
                    <CardDescription className="dark:text-muted-foreground">
                        Leave blank to keep your current password. Min. 8 characters.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold dark:text-foreground">New Password</Label>
                            <div className="relative">
                                <Input
                                    type={showPassword ? 'text' : 'password'}
                                    value={formData.password}
                                    onChange={(e) => update('password', e.target.value)}
                                    placeholder="Min. 8 characters"
                                    className="h-10 dark:border-border dark:bg-background/50 pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-muted-foreground dark:hover:text-foreground transition-colors"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-sm font-semibold dark:text-foreground">Confirm New Password</Label>
                            <div className="relative">
                                <Input
                                    type={showConfirmPassword ? 'text' : 'password'}
                                    value={formData.confirm_password}
                                    onChange={(e) => update('confirm_password', e.target.value)}
                                    placeholder="Re-enter password"
                                    className="h-10 dark:border-border dark:bg-background/50 pr-10"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-muted-foreground dark:hover:text-foreground transition-colors"
                                    tabIndex={-1}
                                >
                                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                    </div>
                </CardContent>
                <CardFooter className="bg-slate-50/50 dark:bg-secondary/10 border-t border-slate-100 dark:border-border flex justify-end px-6 py-4">
                    <Button onClick={handleSave} disabled={loading || (!formData.password && !formData.confirm_password)} variant="outline" className="px-8 dark:border-border">
                        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Updating...</> : 'Update Password'}
                    </Button>
                </CardFooter>
            </Card>

        </div>
    )
}
