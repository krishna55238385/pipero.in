import { getAttendanceStatus, getTeamPerformance } from '@/app/actions/crm'
import AttendanceClient from '@/components/attendance/AttendanceClient'
import PerformanceMonitor from '@/components/attendance/PerformanceMonitor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export default async function AttendancePage() {
    const status = await getAttendanceStatus()
    const isAdmin = status?.user?.role === 'admin' || status?.user?.role === 'super_admin'
    const teamData = isAdmin ? await getTeamPerformance() : null

    return (
        <div className="space-y-6 max-w-7xl mx-auto pb-20">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-foreground">
                        Attendance
                    </h1>
                    <p className="text-sm text-slate-500 dark:text-muted-foreground mt-1 font-medium">
                        {status?.current && !status.current.check_out_time
                            ? "You're checked in. Keep up the great work today."
                            : "You're scheduled for 8 hours today."
                        }
                    </p>
                </div>
            </div>

            {isAdmin ? (
                <Tabs defaultValue="individual" className="space-y-6">
                    <TabsList className="bg-slate-100/50 dark:bg-card/50 p-1 rounded-xl border border-gray-200 dark:border-border">
                        <TabsTrigger value="individual" className="rounded-lg px-6 font-bold text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950 data-[state=active]:shadow-sm">Personal Terminal</TabsTrigger>
                        <TabsTrigger value="team" className="rounded-lg px-6 font-bold text-sm data-[state=active]:bg-white dark:data-[state=active]:bg-slate-950 data-[state=active]:shadow-sm">Team Monitor</TabsTrigger>
                    </TabsList>

                    <TabsContent value="individual" className="mt-0">
                        <AttendanceClient status={status} />
                    </TabsContent>

                    <TabsContent value="team" className="mt-0">
                        <PerformanceMonitor teamData={teamData || []} />
                    </TabsContent>
                </Tabs>
            ) : (
                <AttendanceClient status={status} />
            )}
        </div>
    )
}
