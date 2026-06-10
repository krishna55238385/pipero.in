'use client'

import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useWorkflowBuilderStore } from '@/stores/workflow-builder'

export default function NodePanel() {
  const addNode = useWorkflowBuilderStore((s) => s.addNode)

  return (
    <Card className="rounded-2xl h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Nodes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => addNode('trigger')}>
          <Plus className="h-4 w-4 mr-2" />
          Trigger
        </Button>
        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => addNode('condition')}>
          <Plus className="h-4 w-4 mr-2" />
          Condition
        </Button>
        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => addNode('action')}>
          <Plus className="h-4 w-4 mr-2" />
          Action
        </Button>
      </CardContent>
    </Card>
  )
}

