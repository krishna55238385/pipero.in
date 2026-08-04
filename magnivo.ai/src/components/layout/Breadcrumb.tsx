'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { getBreadcrumbs } from '@/lib/navigation'

export function Breadcrumb() {
    const pathname = usePathname()
    const items = getBreadcrumbs(pathname)

    if (items.length === 0) return null

    return (
        <nav className="flex items-center gap-1 text-xs text-muted-foreground mb-4" aria-label="Breadcrumb">
            {items.map((crumb, index) => {
                const isLast = index === items.length - 1
                return (
                    <span key={crumb.label} className="flex items-center gap-1">
                        {index > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                        {crumb.href && !isLast ? (
                            <Link href={crumb.href} className="hover:text-foreground transition-colors">
                                {crumb.label}
                            </Link>
                        ) : (
                            <span className={isLast ? 'text-foreground font-medium' : ''}>
                                {crumb.label}
                            </span>
                        )}
                    </span>
                )
            })}
        </nav>
    )
}
