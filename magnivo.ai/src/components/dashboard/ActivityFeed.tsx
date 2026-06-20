import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Activity } from "lucide-react"
import { format } from "date-fns"
import { useEffect, useState } from "react"
import { toText } from "@/lib/gtm-render"

export default function ActivityFeed({ activities, title = "Recent Sales Activity", description = "Latest movements in your pipeline." }: { activities: any[], title?: string, description?: string }) {
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    return (
        <Card className="shadow-sm border-gray-200 dark:border-border bg-white dark:bg-card/50 rounded-2xl h-full flex flex-col min-h-0">
            <CardHeader className="pb-4 shrink-0">
                <CardTitle className="text-slate-900 dark:text-foreground">{title}</CardTitle>
                <CardDescription className="text-slate-500 dark:text-muted-foreground">
                    {description}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto min-h-0 pr-2 scrollbar-thin">
                <div className="space-y-6">
                    {activities && activities.length > 0 ? activities.map(activity => (
                        <div key={activity.id} className="flex items-start">
                            <div className="mt-0.5 bg-blue-100 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 p-2 rounded-xl mr-4 flex-shrink-0 shadow-sm">
                                <Activity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="space-y-1 flex-1">
                                <p className="text-sm font-semibold leading-none text-slate-900 dark:text-foreground capitalize break-words">
                                    {String(activity.action || '').replace('_', ' ')}
                                </p>
                                <p className="text-sm text-slate-600 dark:text-muted-foreground font-medium pt-0.5 break-words">
                                    {toText(activity.details)}
                                </p>
                                {/* Optional contextual badges */}
                                {(activity.leads || activity.deals) && (
                                    <div className="flex gap-2 pt-2">
                                        {activity.leads && <span className="text-[10px] font-bold bg-gray-100 dark:bg-secondary px-2.5 py-1 rounded-md text-slate-600 dark:text-muted-foreground border border-gray-200 dark:border-border shadow-sm uppercase tracking-wider">Lead: {activity.leads.name}</span>}
                                        {activity.deals && <span className="text-[10px] font-bold bg-gray-100 dark:bg-secondary px-2.5 py-1 rounded-md text-slate-600 dark:text-muted-foreground border border-gray-200 dark:border-border shadow-sm uppercase tracking-wider">Deal: {activity.deals.title}</span>}
                                    </div>
                                )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-muted-foreground whitespace-nowrap pl-2 font-semibold bg-gray-50 dark:bg-secondary/50 px-2 py-1 rounded-lg">
                                {mounted && activity.created_at ? format(new Date(activity.created_at), 'MM/dd/yyyy') : ''}
                            </div>
                        </div>
                    )) : (
                        <div className="text-center py-12 text-slate-500 dark:text-muted-foreground border border-gray-300 dark:border-border border-dashed rounded-2xl bg-gray-50/50 dark:bg-secondary/30 font-medium">
                            No recent activity found.
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}

