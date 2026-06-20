'use client'

import { useState, useTransition } from 'react'
import { Building2, CheckCircle2, Globe, MapPin, Radio, Search, Users, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getProspectCompanies, type ProspectCompanyRow } from '@/app/actions/gtm'
import type { Icp, IntentScore } from '@/types/gtm'

function IntentBadge({ score }: { score: IntentScore }) {
  const cls =
    score === 'High'
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30'
      : score === 'Medium'
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30'
        : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20'
  return (
    <Badge variant="outline" className={cls}>
      {score}
    </Badge>
  )
}

export function ProspectCompaniesClient({
  initialCompanies,
  icps,
}: {
  initialCompanies: ProspectCompanyRow[]
  icps: Icp[]
}) {
  const [companies, setCompanies] = useState(initialCompanies)
  const [q, setQ] = useState('')
  const [icpId, setIcpId] = useState<string>('all')
  const [loading, startLoading] = useTransition()

  function load() {
    startLoading(async () => {
      const res = await getProspectCompanies({
        q: q || undefined,
        icpId: icpId !== 'all' ? Number(icpId) : undefined,
      })
      setCompanies(res)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Prospect Companies</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Live from the GTM pipeline — {companies.length.toLocaleString()} compan
            {companies.length === 1 ? 'y' : 'ies'} matching your ICP.
          </p>
        </div>
      </div>

      <Tabs defaultValue="filters" className="w-full">
        <TabsList className="bg-muted rounded-lg p-[3px] h-9 w-fit">
          <TabsTrigger value="filters" className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            Search &amp; filter
          </TabsTrigger>
          <TabsTrigger value="ai" className="rounded-md px-3 gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-sm">
            <Zap className="h-3.5 w-3.5 text-purple-500" />
            Search with AI
          </TabsTrigger>
        </TabsList>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="filters" className="mt-6">
          <div className="flex gap-6 flex-col lg:flex-row">
            <Card className="lg:w-72 shrink-0 rounded-xl border bg-card shadow-sm h-fit">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Filters</CardTitle>
                <CardDescription className="text-xs">Refine your company search</CardDescription>
              </CardHeader>
              <CardContent className="px-4 pt-0 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Search</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && load()}
                      placeholder="Company or industry…"
                      className="h-9 text-sm pl-8"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">ICP</label>
                  <Select value={icpId} onValueChange={setIcpId}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="All ICPs" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All ICPs</SelectItem>
                      {icps.map((i) => (
                        <SelectItem key={i.id} value={String(i.id)}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Button className="w-full" size="sm" onClick={load} disabled={loading}>
                  {loading ? 'Loading…' : 'Apply filters'}
                </Button>
              </CardContent>
            </Card>

            <Card className="flex-1 min-w-0 rounded-xl border bg-card shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table className="min-w-[860px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b">
                        <TableHead>Company</TableHead>
                        <TableHead>Industry</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Contacts</TableHead>
                        <TableHead>Intent</TableHead>
                        <TableHead>Signals</TableHead>
                        <TableHead className="w-[110px]">CRM</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {companies.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                            No companies yet. Run an AI search or a pipeline from the ICP page to populate this list.
                          </TableCell>
                        </TableRow>
                      )}
                      {companies.map((c, i) => (
                        <TableRow key={`${c.company}-${i}`} className="border-b hover:bg-muted/50 align-top">
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                                <Building2 className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0">
                                <div className="font-medium truncate max-w-[200px]" title={c.company}>
                                  {c.company}
                                </div>
                                {c.domain && (
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[200px]">
                                    <Globe className="h-3 w-3 shrink-0" />
                                    <span className="truncate" title={c.domain}>
                                      {c.domain}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{c.industry || '—'}</TableCell>
                          <TableCell className="text-sm">
                            {c.location ? (
                              <span className="flex items-center gap-1">
                                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                {c.location}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{c.size || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="gap-1 text-[11px]">
                              <Users className="h-3 w-3 text-muted-foreground" />
                              {c.contactsCount}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <IntentBadge score={c.intentScore} />
                              {c.bestScore != null && (
                                <span className="text-xs text-muted-foreground">{c.bestScore}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {c.signalsCount > 0 ? (
                              <Badge variant="outline" className="w-fit gap-1 text-[11px]">
                                <Radio className="h-3 w-3 text-blue-500" />
                                {c.signalsCount}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {c.promoted ? (
                              <Badge
                                variant="outline"
                                className="gap-1 text-emerald-600 border-emerald-500/30 text-[11px]"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                In CRM
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------------------------------------------------------- */}
        <TabsContent value="ai" className="mt-6">
          <Card className="rounded-xl border bg-card shadow-sm">
            <CardContent className="py-12 text-center">
              <Zap className="h-10 w-10 text-purple-500 mx-auto mb-3" />
              <p className="text-muted-foreground">
                Search with AI — describe your ideal company profile from the Prospect Leads page to run the full
                pipeline. Discovered companies appear here automatically.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
