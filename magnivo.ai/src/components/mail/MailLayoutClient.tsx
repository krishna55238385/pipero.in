'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { engageNavGroups } from '@/lib/engage-nav'
import { cn } from '@/lib/utils'
import { listSubAccountsAction } from '@/app/actions/mail'

const SUB_ACCOUNT_KEY = 'magnivo.engage.activeSubAccountId'

export default function MailLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [subAccounts, setSubAccounts] = useState<Awaited<ReturnType<typeof listSubAccountsAction>>>([])
  const [activeSubAccountId, setActiveSubAccountId] = useState('all')

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(SUB_ACCOUNT_KEY) : null
    if (stored) setActiveSubAccountId(stored)
    void listSubAccountsAction().then(setSubAccounts).catch(() => setSubAccounts([]))
  }, [])

  function onSubAccountChange(value: string) {
    setActiveSubAccountId(value)
    localStorage.setItem(SUB_ACCOUNT_KEY, value)
    window.dispatchEvent(new CustomEvent('engage:sub-account-changed', { detail: { subAccountId: value } }))
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] -mx-4 md:-mx-6">
      <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r bg-muted/20 overflow-y-auto sticky top-0 max-h-[calc(100vh-4rem)]">
        <div className="px-4 py-4 border-b space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Engage</p>
            <p className="text-sm font-semibold mt-0.5">Cold outreach platform</p>
          </div>
          <div>
            <label htmlFor="global-sub-account" className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Sub-account
            </label>
            <select
              id="global-sub-account"
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-xs"
              value={activeSubAccountId}
              onChange={(e) => onSubAccountChange(e.target.value)}
            >
              <option value="all">All (workspace)</option>
              {subAccounts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-4">
          {engageNavGroups.map((group) => (
            <div key={group.label}>
              <p className="px-2 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href !== '/mail' && pathname.startsWith(item.href + '/')) ||
                    (item.href !== '/mail' && pathname === item.href)
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-xs transition-colors',
                          active
                            ? 'bg-primary text-primary-foreground font-medium'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {item.name}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 min-w-0 px-4 md:px-6 py-4">
        <div className="lg:hidden mb-4 overflow-x-auto">
          <div className="flex gap-2 min-w-max pb-1">
            {engageNavGroups.flatMap((g) => g.items).slice(0, 12).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs whitespace-nowrap',
                  pathname === item.href ? 'bg-primary text-primary-foreground border-primary' : 'bg-background'
                )}
              >
                {item.name}
              </Link>
            ))}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}
