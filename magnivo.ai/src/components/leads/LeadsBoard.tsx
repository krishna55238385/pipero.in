'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { updateLeadField } from '@/app/actions/crm'
import { Thermometer, ThermometerSnowflake, ThermometerSun, GripVertical, Building2, Phone } from 'lucide-react'
import { formatPhoneUS } from '@/lib/formatters'
import { toast } from 'sonner'
import Link from 'next/link'

const COLUMNS = [
    { id: 'New', title: 'New' },
    { id: 'Contacted', title: 'Contacted' },
    { id: 'Qualified', title: 'Qualified' },
    { id: 'Proposal Sent', title: 'Proposal Sent' },
    { id: 'Won', title: 'Won' },
    { id: 'Lost', title: 'Lost' },
]

export default function LeadsBoard({ initialLeads }: { initialLeads: any[] }) {
    const [leads, setLeads] = useState(initialLeads)

    useEffect(() => {
        setLeads(initialLeads)
    }, [initialLeads])

    async function onDragEnd(result: DropResult) {
        const { destination, source, draggableId } = result;

        if (!destination) return;
        if (destination.droppableId === source.droppableId && destination.index === source.index) return;

        // Optimistic UI update
        const newLeads = Array.from(leads);
        const movedLeadIndex = newLeads.findIndex(l => l.id === draggableId);

        if (movedLeadIndex !== -1) {
            const [movedLead] = newLeads.splice(movedLeadIndex, 1);
            movedLead.status = destination.droppableId;
            newLeads.splice(destination.index, 0, movedLead);
            setLeads(newLeads);

            const res = await updateLeadField(draggableId, 'status', destination.droppableId)
            if (!res.success) {
                toast.error(res.error || 'Failed to update lead status', { id: 'move-lead' })
            }
        }
    }

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4 hide-scrollbar snap-x">
                {COLUMNS.map((column) => (
                    <div key={column.id} className="min-w-[300px] w-[300px] snap-center shrink-0 flex flex-col h-[calc(100vh-280px)]">
                        <div className="flex items-center justify-between mb-3 px-1">
                            <h3 className="font-semibold text-slate-700 dark:text-muted-foreground flex items-center gap-2 text-sm uppercase tracking-wide">
                                {column.title}
                                <Badge variant="secondary" className="bg-slate-100 dark:bg-secondary text-slate-500 dark:text-muted-foreground font-medium">
                                    {leads.filter(l => l.status === column.id).length}
                                </Badge>
                            </h3>
                        </div>

                        <Droppable droppableId={column.id}>
                            {(provided, snapshot) => (
                                <div
                                    {...provided.droppableProps}
                                    ref={provided.innerRef}
                                    className={`flex-1 overflow-y-auto min-h-[150px] rounded-2xl p-2 transition-colors duration-200 border border-transparent ${snapshot.isDraggingOver ? 'bg-blue-50/50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-900/50' : 'bg-gray-50/50 dark:bg-secondary/20 shadow-inner'}`}
                                >
                                    {leads.filter(l => l.status === column.id).map((lead, index) => (
                                        <Draggable key={lead.id} draggableId={lead.id} index={index}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    {...provided.dragHandleProps}
                                                    className={`mb-3 transition-transform duration-200 ${snapshot.isDragging ? 'rotate-2 scale-105 shadow-xl' : 'shadow-sm hover:shadow-md'}`}
                                                    style={{ ...provided.draggableProps.style }}
                                                >
                                                    <Card className="bg-white dark:bg-card/80 border-gray-100 dark:border-border overflow-hidden group rounded-xl backdrop-blur-sm">
                                                        <CardContent className="p-4 relative">
                                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-blue-400 to-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                                                            <div className="flex justify-between items-start mb-2">
                                                                <Link href={`/leads/${lead.id}`} className="font-semibold text-slate-900 dark:text-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-sm line-clamp-1 block pr-6">
                                                                    {lead.name}
                                                                </Link>
                                                                <GripVertical className="h-4 w-4 text-slate-300 dark:text-slate-600 cursor-grab absolute right-4 top-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                            </div>
                                                            <div className="flex flex-col gap-1.5 mb-3 text-xs text-slate-500 dark:text-muted-foreground">
                                                                {lead.contact_person && (
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Building2 className="h-3 w-3" />
                                                                        <span className="truncate">{lead.contact_person}</span>
                                                                    </div>
                                                                )}
                                                                {lead.phone_number && (
                                                                    <div className="flex items-center gap-1.5">
                                                                        <Phone className="h-3 w-3" />
                                                                        <span>{formatPhoneUS(lead.phone_number)}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-between mt-auto pt-2 border-t border-gray-50 dark:border-border/50">
                                                                <div className="flex flex-wrap gap-1">
                                                                    {lead.tags?.slice(0, 2).map((tag: string, i: number) => (
                                                                        <Badge key={i} variant="outline" className="text-[9px] px-1 py-0 h-4 bg-gray-50/50 dark:bg-secondary text-slate-500 border-gray-200 dark:border-border">
                                                                            {tag}
                                                                        </Badge>
                                                                    ))}
                                                                    {lead.tags?.length > 2 && (
                                                                        <span className="text-[10px] text-slate-400">+{lead.tags.length - 2}</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center justify-end" title={`Temperature: ${lead.temperature || 'cold'}`}>
                                                                    <div className="w-10 bg-slate-100 dark:bg-secondary rounded-full h-1 overflow-hidden mr-2" title={`Health Score: ${lead.health_score || 50}`}>
                                                                        <div
                                                                            className={`h-full ${lead.health_score >= 80 ? 'bg-green-500' : lead.health_score >= 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                                                                            style={{ width: `${Math.min(100, Math.max(0, lead.health_score || 50))}%` }}
                                                                        ></div>
                                                                    </div>
                                                                    {lead.temperature === 'hot' && <ThermometerSun className="h-3.5 w-3.5 text-red-500 ml-1" />}
                                                                    {lead.temperature === 'warm' && <Thermometer className="h-3.5 w-3.5 text-amber-500 ml-1" />}
                                                                    {lead.temperature === 'cold' && <ThermometerSnowflake className="h-3.5 w-3.5 text-cyan-500 ml-1" />}
                                                                </div>
                                                            </div>
                                                        </CardContent>
                                                    </Card>
                                                </div>
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </div>
                ))}
            </div>
        </DragDropContext>
    )
}

